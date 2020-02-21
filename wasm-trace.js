#!node --experimental-wasm-bigint

"use strict";

/*
 * Author: Volodymyr Shymanskyy
 */

const fs = require("fs");

const Wasi = require("@wasmer/wasi");
const Node = require("@wasmer/wasi/lib/bindings/node");
const Binaryen = require("binaryen");

function fatal(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

function log(msg) {
  console.error(`[tracer] ${msg}`);
}

(async () => {
  const fileToRun = process.argv[2]
  const wasiArgs = process.argv.slice(3)
  const wasiEnv = {}
  const wasiPreopens = { ".": "./" }

  // Add the wasm module to the front of the args
  wasiArgs.unshift(fileToRun);

  const wasi = new Wasi.WASI({
    args: wasiArgs,
    env:  wasiEnv,
    preopens: wasiPreopens,
    bindings: Object.assign(Object.assign({}, Node.default), { fs }),
  });
  let binary;
  try {
    binary = fs.readFileSync(fileToRun);
  } catch (e) {
    fatal(`File ${fileToRun} not found`);
  }

  log("Instrumenting...")

  Binaryen.setDebugInfo(true);
  let module = Binaryen.readBinary(binary);
  module.runPasses(["log-execution", "instrument-locals", "instrument-memory"]);
  if (!module.validate()) {
    fatal(`Validation failed`);
  }
  binary = module.emitBinary();
  module.dispose();
  fs.writeFileSync(fileToRun + ".inst", binary);

  /* I64 transform is not needed (as soon as we're running with wasm-bigint support)
  log("I64 transform...");
  const WasmTransformer = require("@wasmer/wasm-transformer");
  binary = await WasmTransformer.lowerI64Imports(binary);
  fs.writeFileSync(fileToRun + ".trans", binary);
  */

  const trace = fs.createWriteStream('trace.log');

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

  log("Running...")
  const { instance } = await WebAssembly.instantiate(binary, {
    wasi_unstable: wasi.wasiImport,
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
  });
  wasi.start(instance);
})();
