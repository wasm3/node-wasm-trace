#!node --experimental-wasm-bigint

"use strict";

/*
 * Author: Volodymyr Shymanskyy
 *
 * TODO:
 * - Fix bigint parsing and formatting
 * - Trace calls to imported functions
 * - Trace and return values
 * - Trace memory.grow
 */

const fs = require("fs");
const chalk = require("chalk");
const assert = require('assert').strict;
const readline = require('readline');
const stream = require('stream');
const tmp = require('tmp');

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
    .example('$0 ./test/hello.instrumented.wasm',               'Run pre-instrumented wasm file')
    .example('$0 --process=trace.csv ./instrumented.wasm',      'Just process an existing CSV trace file')
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
        describe: "Optimize (use --no-opt to disable)",
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
      "save-csv": {
        type: "string",
        describe: "Save CSV log file to ...",
        nargs: 1
      },

      // Other options
      "process": {
        type: "string",
        describe: "Process CSV log file",
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
    output.push(line);
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

  if (!inputFile) {
    fatal(`Please specify input file. See ${chalk.white.bold('--help')} for details.`);
  }

  let binary;
  try {
    binary = fs.readFileSync(inputFile);
  } catch (e) {
    fatal(`File ${chalk.white.bold(inputFile)} not found`);
  }

  // If just post-processing is needed
  if (argv.process) {
    const csv = fs.createReadStream(argv.process);
    await post_process(binary, csv, argv);
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

  const csvTraceFn = tmp.tmpNameSync({prefix: '.wasm-trace', postfix: '.csv', tmpdir: './'});
  const csv_output = fs.createWriteStream(csvTraceFn);
  await execute(binary, csv_output, argv)
  csv_output.end();

  const csv_input = fs.createReadStream(csvTraceFn);
  await post_process(binary, csv_input, argv);
  csv_input.destroy();

  // Cleanup
  if (argv.saveCsv) {
    fs.renameSync(csvTraceFn, argv.saveCsv)
  } else {
    fs.unlinkSync(csvTraceFn)
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

async function execute(binary, trace, opts)
{
  const traceGeneric = (name) => function() {
    trace.write(name + ';' + Array.from(arguments).join(';') + '\n');
  }

  const traceRetLast = (name) => function() {
    trace.write(name + ';' + Array.from(arguments).join(';') + '\n');
    return arguments[arguments.length-1];
  }

  let imports = {
    env: {
      log_execution:  traceGeneric("exec"),

      log_exec_enter: traceGeneric("enter"),
      log_exec_exit:  traceGeneric("exit"),
      log_exec_loop:  traceGeneric("loop"),

           load_ptr:  traceRetLast( "load ptr"),
          store_ptr:  traceRetLast("store ptr"),
       load_val_i32:  traceRetLast( "load i32"),
      store_val_i32:  traceRetLast("store i32"),
       load_val_i64:  traceRetLast( "load i64"),
      store_val_i64:  traceRetLast("store i64"),
       load_val_f32:  traceRetLast( "load f32"),
      store_val_f32:  traceRetLast("store f32"),
       load_val_f64:  traceRetLast( "load f64"),
      store_val_f64:  traceRetLast("store f64"),

      get_i32:        traceRetLast("get i32"),
      set_i32:        traceRetLast("set i32"),
      get_i64:        traceRetLast("get i64"),
      set_i64:        traceRetLast("set i64"),
      get_f32:        traceRetLast("get f32"),
      set_f32:        traceRetLast("set f32"),
      get_f64:        traceRetLast("get f64"),
      set_f64:        traceRetLast("set f64"),
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
}

async function post_process(binary, csv, opts)
{
  log(`Processing...`)

  const wasmInfo = await analyze_wasm(binary);

  if (!wasmInfo.isInstrumented) {
    fatal("Processing CSV trace file requires input of corresponding pre-instrumented wasm file")
  }

  const trace = fs.createWriteStream(opts.output);
  const reader = readLines(csv);

  function parseLine(line) {
    const elements = line.split(";").map((s) => s.trim());
    return {
      cmd:  elements[0],
      id:   parseInt(elements[1], 10),
      args: elements.slice(2).map((s) => parseFloat(s)),
    }
  }

  const ctx = {
    exec_depth: 0,
    mem: {}
  }

  function traceWrite({id, type, body, comment}) {
    type = type || "";
    let prefix = id.toString().padStart(6) + ' | ' + type.padEnd(3) + ' | ' + '  '.repeat(Math.max(0, ctx.exec_depth));

    trace.write(prefix + body + '\n')
  }

  function getFunctionName(i) {
    if (wasmInfo.functions[i]) {
      return wasmInfo.functions[i].name;
    } else {
      return '$'+i;
    }
  }

  const traceMemory = (name, type) => function (id, val) {
    assert(ctx.mem[id]);
    const args = ctx.mem[id];
    traceWrite({id, type, body: `${name.padEnd(6)} ${args.address}+${args.offset} ${args.bytes} ${val}`});
    ctx.mem[id] = undefined;
    return val;
  };

  const traceLocal = (name, type) => function (id, local, val) {
    traceWrite({id, type, body: `${name.padEnd(6)} ${local} ${val}`});
    return val;
  };

  const lookup = {
    "exec": function (id) {
      traceWrite({id, body: "exec"});
    },

    "enter": function (id, func) {

      // Lookahead (check if func is empty)
      let next, funcIsEmpty = false;
      if (next = reader.read()) {
        const l = parseLine(next);
        if (l.cmd == "exit" && l.args[0] == func) {
          funcIsEmpty = true;
        } else {
          reader.unshift(next);
        }
      }

      const fname = getFunctionName(func)

      if (funcIsEmpty) {
        traceWrite({id, body: `enter ${fname} {}`});
      } else {
        traceWrite({id, body: `enter ${fname} {`});
        ctx.exec_depth+=1;
      }
    },
    "exit": function (id, func) {
      ctx.exec_depth-=1;
      traceWrite({id, body: "}"});
    },
    "loop": function (id) {

      // Lookahead (check if this is a loop sequence)
      let next, loopCount = 1;
      while (next = reader.read()) {
        const l = parseLine(next);
        if (l.cmd == "loop" && l.id == id) {
          loopCount++;
        } else {
          reader.unshift(next);
          break;
        }
      }

      if (loopCount == 1) {
        traceWrite({id, body: `loop`});
      } else {
        traceWrite({id, body: `loop [${loopCount} times]`});
      }
    },

    "load ptr": function (id, bytes, offset, address) {
      assert.equal(ctx.mem[id], undefined)
      ctx.mem[id] = { bytes, offset, address }
    },
    "store ptr": function (id, bytes, offset, address) {
      assert.equal(ctx.mem[id], undefined)
      ctx.mem[id] = { bytes, offset, address }
    },

     "load i32": traceMemory("load" , "i32"),
    "store i32": traceMemory("store", "i32"),
     "load i64": traceMemory("load" , "i64"),
    "store i64": traceMemory("store", "i64"),
     "load f32": traceMemory("load" , "f32"),
    "store f32": traceMemory("store", "f32"),
     "load f64": traceMemory("load" , "f64"),
    "store f64": traceMemory("store", "f64"),

    "get i32":   traceLocal("get", "i32"),
    "set i32":   traceLocal("set", "i32"),
    "get i64":   traceLocal("get", "i64"),
    "set i64":   traceLocal("set", "i64"),
    "get f32":   traceLocal("get", "f32"),
    "set f32":   traceLocal("set", "f32"),
    "get f64":   traceLocal("get", "f64"),
    "set f64":   traceLocal("set", "f64"),
  };

  for await (const line of reader) {
    const l = parseLine(line);

    if (lookup[l.cmd]) {
      lookup[l.cmd](l.id, ...l.args);
    } else {
      traceWrite({
        id:   l.id,
        body: `${l.cmd.padEnd(6)} ${l.args.join(' ')}`,
      });
    }
  }
}

