#!node --experimental-wasm-bigint

"use strict";

/*
 * Author: Volodymyr Shymanskyy
 *
 * TODO:
 * - Switch RAW format to CSV
 * - Instrument
 *   - Calls to imported functions
 *   - Arguments and return values
 * - Post-process
 *   - Collapse chain of loops (display count)
 *   - Collapse empty function {} to a single line
 */

const fs = require("fs");
const chalk = require("chalk");
const assert = require('assert').strict;
const readline = require('readline');
const stream = require('stream');

const Wasi = require("@wasmer/wasi");
const Node = require("@wasmer/wasi/lib/bindings/node");
const Binaryen = require("binaryen");

/*
 * Arguments
 */

const argv = require("yargs")
    .usage("$0 [options] <file> [args..]")
    .example('$0 -E ./test/hello.wasm',                         'Instrument, run and trace WASI app')
    .example('$0 -ELM --invoke=fib ./test/fib32.wasm 20',       'Instrument, run and trace plain wasm file')
    .example('$0 ./instrumented.wasm',                          'Run pre-instrumented wasm file')
    .example('$0 --process=trace.raw.log ./instrumented.wasm',  'Just process an existing raw trace file')
    .option({
      // Instrumentation options
      "execution": {
        alias: "E",
        type: "boolean",
        describe: "Instrument execution",
      },
      "locals": {
        alias: "L",
        type: "boolean",
        describe: "Instrument locals",
      },
      "memory": {
        alias: "M",
        type: "boolean",
        describe: "Instrument memory",
      },
      "optimize": {
        alias: "opt",
        type: "boolean",
        describe: "Optimize after instrumenting",
        default: true,
      },

      // Output options
      "output": {
        alias: "o",
        type: "string",
        describe: "Output filename",
        default: "trace.log",
        nargs: 1
      },
      "save-wasm": {
        type: "string",
        describe: "Save instrumented wasm to ...",
        nargs: 1
      },
      "save-raw": {
        type: "string",
        describe: "Save raw log file to ...",
        nargs: 1
      },

      // Other options
      "process": {
        type: "string",
        describe: "Process raw log file",
        nargs: 1
      },
      "invoke": {
        alias: "i",
        type: "string",
        describe: "Invoke a specified function",
        nargs: 1
      },
    })
    .string('_')
    .strict()
    .version()
    .help()
    .wrap(null)
    .argv;

/*
 * Helpers
 */

function readLines(input) {
  const output = new stream.PassThrough({ objectMode: true });
  const rl = readline.createInterface({ input });
  rl.on("line", line => {
    output.write(line);
  });
  rl.on("close", () => {
    output.push(null);
  });
  return output;
}

function fatal(msg) {
  console.error(chalk.grey('[tracer] ') + chalk.red.bold("Error: ") + msg);
  process.exit(1);
}

function warn(msg) {
  console.error(chalk.grey('[tracer] ') + chalk.yellow.bold("Warning: ") + msg);
}

function log(msg) {
  console.error(chalk.grey('[tracer] ') + msg);
}

/*
 * Main
 */

(async () => {
  const inputFile = argv._[0]

  let binary;
  try {
    binary = fs.readFileSync(inputFile);
  } catch (e) {
    fatal(`File ${inputFile} not found`);
  }

  // If just post-processing is needed
  if (argv.process) {
    const raw = fs.createReadStream(argv.process);
    await post_process(binary, raw, argv);
    return;
  }

  argv.args = argv._.slice(1);
  argv._wasmInfo = await analyze_wasm(binary);

  binary = await instrument(binary, argv);

  if (argv.saveWasm) {
    fs.writeFileSync(argv.saveWasm, binary);
  }

  /* I64 transform is not needed (as soon as we're running with wasm-bigint support)
  log("I64 transform...");
  const WasmTransformer = require("@wasmer/wasm-transformer");
  binary = await WasmTransformer.lowerI64Imports(binary);
  */

  await execute(binary, argv)

  const raw = fs.createReadStream(".wasm-trace.raw");
  await post_process(binary, raw, argv);

  // Cleanup
  if (argv.saveRaw) {
    fs.renameSync(".wasm-trace.raw", argv.saveRaw)
  } else {
    fs.unlinkSync(".wasm-trace.raw")
  }
})();

async function analyze_wasm(binary)
{
  let result = {
    isWasi: false,
    isInstrumented: false,
    functions: []
  };
  Binaryen.setDebugInfo(true);
  let module = Binaryen.readBinary(binary);
  if (!module.validate()) {
    fatal(`Validation failed`);
  }

  const instrument_funcs = [
    "log_execution",          // log-execution
    "log_exec_enter",         // log-execution-ex
    "log_exec_exit",
    "log_exec_loop",
    "load_ptr", "store_ptr",  // instrument-memory
    "get_i32", "set_i32",     // instrument-locals
    "get_i64", "set_i64",
    "get_f32", "set_f32",
    "get_f64", "set_f64",
  ];

  for (let i = 0; i < module.getNumFunctions(); i++) {
    let f = module.getFunctionByIndex(i);
    let info = Binaryen.getFunctionInfo(f);

    result.functions[i] = info;

    if (info.body == 0 && info.module.startsWith("wasi_")) {
      result.isWasi = true;
    } else if (info.body == 0 && info.module == "env" &&
               instrument_funcs.includes(info.base)) {
      result.isInstrumented = true;
    }
  }

  module.dispose();

  return result;
}

async function instrument(binary, opts)
{
  const workNeeded = (opts.locals || opts.memory || opts.execution);
  if (workNeeded && opts._wasmInfo.isInstrumented) {
    fatal(`Wasm file seems to be already instrumented => refusing to instrument`)
  } else if (!workNeeded) {
    if (!opts._wasmInfo.isInstrumented) {
      warn(`No instrumentation was applied (consider using -E, -L, -M flags)`)
    }
    return binary;
  }

  if (opts.optimize) {
    log("Instrumenting and optimizing...")
  } else {
    log("Instrumenting...")
  }

  Binaryen.setDebugInfo(true);
  let module = Binaryen.readBinary(binary);

  // 1. instrument-locals, instrument-memory, ...
  if (opts.locals) {
    module.runPasses(["instrument-locals"]);
  }
  if (opts.memory) {
    module.runPasses(["instrument-memory"]);
  }

  // 3. log-execution
  if (opts.execution) {
    if (opts.optimize) {  // pre-optimize
      // TODO: converge?
      module.optimize();
    }
    module.runPasses(["flatten", "log-execution"]);
  }

  // 4. final optimize
  if (opts.optimize) {
    module.optimize();
  }

  if (!module.validate()) {
    fatal(`Validation failed`);
  }
  let result = module.emitBinary();
  module.dispose();
  return result;
}

async function execute(binary, opts)
{
  const trace = fs.createWriteStream(".wasm-trace.raw");

  function traceMemory(name) {
    return (id, val) => {
      trace.write(`${name}: ${id} ${val}\n`);
      return val;
    }
  }

  function traceLocal(name) {
    return (id, local, val) => {
      trace.write(`${name}: ${id} ${local} ${val}\n`);
      return val;
    }
  }

  let imports = {
    env: {
      log_execution: function (id) {
        trace.write(`exec: ${id}\n`);
      },

      log_exec_enter: function (id, func) {
        trace.write(`enter: ${id} ${func}\n`);
      },
      log_exec_exit: function (id, func) {
        trace.write(`exit: ${id} ${func}\n`);
      },
      log_exec_loop: function (id) {
        trace.write(`loop: ${id}\n`);
      },

      load_ptr: function (id, align, offset, address) {
        trace.write(`load ptr: ${id} ${align} ${offset} ${address}\n`);
        return address;
      },
      store_ptr: function (id, align, offset, address) {
        trace.write(`store ptr: ${id} ${align} ${offset} ${address}\n`);
        return address;
      },

       load_val_i32: traceMemory( "load i32"),
      store_val_i32: traceMemory("store i32"),
       load_val_i64: traceMemory( "load i64"),
      store_val_i64: traceMemory("store i64"),
       load_val_f32: traceMemory( "load f32"),
      store_val_f32: traceMemory("store f32"),
       load_val_f64: traceMemory( "load f64"),
      store_val_f64: traceMemory("store f64"),

      get_i32: traceLocal("get i32"),
      set_i32: traceLocal("set i32"),
      get_i64: traceLocal("get i64"),
      set_i64: traceLocal("set i64"),
      get_f32: traceLocal("get f32"),
      set_f32: traceLocal("set f32"),
      get_f64: traceLocal("get f64"),
      set_f64: traceLocal("set f64"),
    }
  }

  if (opts._wasmInfo.isWasi) {
    log(`Running WASI...`)

    const wasi = new Wasi.WASI({
      args:     opts._,
      env:      {},
      preopens: { "./": "./" },
      bindings: Object.assign({}, Node.default, { fs }),
    });

    const { instance } = await WebAssembly.instantiate(binary,
      Object.assign({}, imports, { wasi_unstable: wasi.wasiImport })
    );

    if (opts.invoke) {
      let result = instance.exports[opts.invoke](...opts.args);
      log(`Result: ${result}`);
    } else {
      wasi.start(instance);
    }
  } else if (opts.invoke) {
    log(`Running ${opts.invoke}(${opts.args.join()})...`)

    const { instance } = await WebAssembly.instantiate(binary, imports);

    let result = instance.exports[opts.invoke](...opts.args);
    log(`Result: ${result}`);
  } else {
    fatal("Cannot execute: entry function not specified")
  }

  trace.end();
}

async function post_process(binary, raw, opts)
{
  log(`Processing...`)

  const wasmInfo = await analyze_wasm(binary);

  if (!wasmInfo.isInstrumented) {
    fatal("Processing raw trace file requires input of corresponding pre-instrumented wasm file")
  }

  const trace = fs.createWriteStream(opts.output);

  const ctx = {
    exec_depth: 0,
    mem: {}
  }

  function indent(id) {
    return id.toString().padStart(6) + ' | ' + '  '.repeat(Math.max(0, ctx.exec_depth));
  }

  function getFunctionName(i) {
    if (wasmInfo.functions[i]) {
      return wasmInfo.functions[i].name;
    } else {
      return '$'+i;
    }
  }

  const traceMemory = (name) => ({
    [name]: (id, val) => {
      assert(ctx.mem[id]);
      trace.write(indent(id)+`${name}: ${ctx.mem[id].address}+${ctx.mem[id].offset} ${val}\n`);
      ctx.mem[id] = undefined;
      return val;
    }
  });

  const traceLocal = (name) => ({
    [name]: (id, local, val) => {
      trace.write(indent(id)+`${name}: ${local} ${val}\n`);
      return val;
    }
  });

  const lookup = {
    "exec": function (id) {
      trace.write(indent(id)+`exec\n`);
    },

    "enter": function (id, func) {
      trace.write(indent(id)+`enter ${getFunctionName(func)} {\n`);
      ctx.exec_depth+=1;
    },
    "exit": function (id, func) {
      ctx.exec_depth-=1;
      trace.write(indent(id)+`}\n`);
    },
    "loop": function (id) {
      trace.write(indent(id)+`loop\n`);
    },

    "load ptr": function (id, align, offset, address) {
      assert.equal(ctx.mem[id], undefined)
      ctx.mem[id] = { align, offset, address }
    },
    "store ptr": function (id, align, offset, address) {
      assert.equal(ctx.mem[id], undefined)
      ctx.mem[id] = { align, offset, address }
    },

    ...traceMemory( "load i32"),
    ...traceMemory("store i32"),
    ...traceMemory( "load i64"),
    ...traceMemory("store i64"),
    ...traceMemory( "load f32"),
    ...traceMemory("store f32"),
    ...traceMemory( "load f64"),
    ...traceMemory("store f64"),

    ...traceLocal("get i32"),
    ...traceLocal("set i32"),
    ...traceLocal("get i64"),
    ...traceLocal("set i64"),
    ...traceLocal("get f32"),
    ...traceLocal("set f32"),
    ...traceLocal("get f64"),
    ...traceLocal("set f64"),
  };

  for await (const line of readLines(raw)) {
    let elements = line.split(":").map((s) => s.trim());
    const cmd = elements[0];
    const args = elements[1].split(" ").map((s) => parseInt(s, 10));

    lookup[cmd](...args);
  }
}

