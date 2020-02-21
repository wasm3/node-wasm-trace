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

  /*
  log("I64 transform...");
  const WasmTransformer = require("@wasmer/wasm-transformer");
  binary = await WasmTransformer.lowerI64Imports(binary);
  fs.writeFileSync(fileToRun + ".trans", binary);
  */

  const trace = fs.createWriteStream('trace.log');

  log("Running...")
  const { instance } = await WebAssembly.instantiate(binary, {
    wasi_unstable: wasi.wasiImport,
    env: {
      log_execution: function (id) {
        trace.write(`exec: ${id}\n`);
      },
      load_ptr: function (id, id1, id2, val) {
        trace.write(`load ptr: ${id} ${id1} ${id2} ${val}\n`);
        return val;
      },
      store_ptr: function (id, id1, id2, val) {
        trace.write(`store ptr: ${id} ${id1} ${id2} ${val}\n`);
        return val;
      },
      load_val_i32: function (id, val) {
        trace.write(`load i32: ${id} ${val}\n`);
        return val;
      },
      store_val_i32: function (id, val) {
        trace.write(`store i32: ${id} ${val}\n`);
        return val;
      },
      load_val_i64: function (id, val) {
        trace.write(`load i32: ${id} ${val}\n`);
        return val;
      },
      store_val_i64: function (id, val) {
        trace.write(`store i32: ${id} ${val}\n`);
        return val;
      },
      load_val_f32: function (id, val) {
        trace.write(`load f32: ${id} ${val}\n`);
        return val;
      },
      store_val_f32: function (id, val) {
        trace.write(`store f32: ${id} ${val}\n`);
        return val;
      },
      load_val_f64: function (id, val) {
        trace.write(`load f64: ${id} ${val}\n`);
        return val;
      },
      store_val_f64: function (id, val) {
        trace.write(`store f64: ${id} ${val}\n`);
        return val;
      },

      get_i32: function (id, offset, val) {
        trace.write(`get i32: ${id} ${offset} ${val}\n`);
        return val;
      },
      set_i32: function (id, offset, val) {
        trace.write(`set i32: ${id} ${offset} ${val}\n`);
        return val;
      },
      get_i64: function (id, offset, val) {
        trace.write(`get i64: ${id} ${offset} ${val}\n`);
        return val;
      },
      set_i64: function (id, offset, val) {
        trace.write(`set i64: ${id} ${offset} ${val}\n`);
        return val;
      },

      get_f32: function (id, offset, val) {
        trace.write(`get f32: ${id} ${offset} ${val}\n`);
        return val;
      },
      set_f32: function (id, offset, val) {
        trace.write(`set f32: ${id} ${offset} ${val}\n`);
        return val;
      },
      get_f64: function (id, offset, val) {
        trace.write(`get f64: ${id} ${offset} ${val}\n`);
        return val;
      },
      set_f64: function (id, offset, val) {
        trace.write(`set f64: ${id} ${offset} ${val}\n`);
        return val;
      },
    }
  });
  wasi.start(instance);
})();
