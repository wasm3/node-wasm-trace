#!node --experimental-wasm-bigint

"use strict";

/*
 * Author: Volodymyr Shymanskyy
 *
 * TODO:
 * - Post-processing
 */

const fs = require("fs");

const Wasi = require("@wasmer/wasi");
const Node = require("@wasmer/wasi/lib/bindings/node");
const Binaryen = require("binaryen");

const argv = require("yargs")
    .usage("$0 [options] <file> [args..]")
    .example('$0 -E ./test/hello.wasm', 'Instrument, run and trace WASI app')
    .example('$0 -ELM -i fib ./test/fib32.wasm 20', 'Instrument, run and trace plain wasm file')
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
      "wasm-output": {
        type: "string",
        describe: "Output instrumented wasm to ...",
        nargs: 1
      },

      // Other options
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

//console.log(argv)

(async () => {
  const inputFile = argv._[0]

  let binary;
  try {
    binary = fs.readFileSync(inputFile);
  } catch (e) {
    fatal(`File ${inputFile} not found.`);
  }

  argv.args = argv._.slice(1);
  argv._wasmInfo = await analyze_wasm(binary);

  binary = await instrument(binary, argv);

  if (argv.wasmOutput) {
    fs.writeFileSync(argv.wasmOutput, binary);
  }

  /* I64 transform is not needed (as soon as we're running with wasm-bigint support)
  log("I64 transform...");
  const WasmTransformer = require("@wasmer/wasm-transformer");
  binary = await WasmTransformer.lowerI64Imports(binary);
  */

  await execute(binary, argv)
})();


function fatal(msg) {
  console.error(`[tracer] Error: ${msg}`);
  process.exit(1);
}

function log(msg) {
  console.error(`[tracer] ${msg}`);
}

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
    "log_execution",
    "load_ptr", "store_ptr",
    "get_i32", "set_i32",
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
  let passes = []; //"flatten"

  if (opts.execution) passes.push("log-execution");
  if (opts.locals)    passes.push("instrument-locals");
  if (opts.memory)    passes.push("instrument-memory");

  if (0 == passes.length) {
    if (!opts._wasmInfo.isInstrumented) {
      log(`Warning: No instrumentation was applied. Consider using -E, -L, -M flags`)
    }
    return binary;
  }

  if (opts._wasmInfo.isInstrumented) {
    fatal(`Wasm file seems to be already instrumented. Refusing to instrument: ${passes}.`)
  }

  log("Instrumenting...")

  Binaryen.setDebugInfo(true);
  let module = Binaryen.readBinary(binary);
  module.runPasses(passes);

  if (opts.optimize) {
    log("Optimizing...")
    module.optimize();
  }

  if (!module.validate()) {
    fatal(`Validation failed.`);
  }
  let result = module.emitBinary();
  module.dispose();
  return result;
}

async function execute(binary, opts)
{
  const trace = fs.createWriteStream(opts.output);

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
      preopens: { ".": "./" },
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
    fatal("Cannot execute: entry function not specified.")
  }

  trace.end();
}
