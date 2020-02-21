# wasm-trace
Instruments wasm files and traces execution, using Binaryen.js and Wasmer.js

**Note:** Currently this tool requires an experimental feature of Node.js: `wasm-bigint`.  
It can be enabled globally or when running a single command:
```sh
node --experimental-wasm-bigint {command}
```
It's recommended to use the most recent version of Node.js.

### Install

```sh
npm i -g https://github.com/wasm3/wasm-trace.git
```

### Usage examples

```sh
$ wasm-trace ./test/hello.wasm
[tracer] Instrumenting...
[tracer] Running...
Hello WebAssembly!
```
The trace can be found in `trace.log`.

You can also pass arguments to WASI apps:
```sh
$ wasm-trace qjs.wasm fib.js 10
...
$ wasm-trace wasm3.wasm ./test/hello.wasm
...
```

### How it works

1. The input file is instrumented with `Binaryen.js`.
   This step is the same as using `wasm-opt` with `--log-execution`, `--instrument-memory`, `--instrument-locals` options.
2. Runs the instrumented file with `Wasmer.js` + injected instrumentation handlers.
3. Writes the produced traces to `trace.log`.

