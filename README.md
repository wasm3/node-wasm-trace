# wasm-trace
Instruments wasm files and traces execution, using **Binaryen.js** and **Wasmer.js**

- [`log-execution`](https://github.com/WebAssembly/binaryen/blob/master/src/passes/LogExecution.cpp) logs execution at each function `entry`, `loop` header, and `return`
- [`instrument-memory`](https://github.com/WebAssembly/binaryen/blob/master/src/passes/InstrumentMemory.cpp) intercepts all memory reads and writes
- [`instrument-locals`](https://github.com/WebAssembly/binaryen/blob/master/src/passes/InstrumentLocals.cpp) intercepts all local reads and writes

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
The trace can be found in `trace.log`:
```log
exec: 5
set i32: 0 0 68256
exec: 50
exec: 8
get i32: 32 0 16
exec: 25
set i32: 33 1 68240
get i32: 34 0 16
load ptr: 5 4 1056 0
load i32: 5 0
set i32: 35 2 0
get i32: 36 0 16
...
```

You can also pass arguments to WASI apps:
```sh
$ wasm-trace qjs.wasm fib.js 10
...
$ wasm-trace wasm3.wasm ./test/hello.wasm
...
```

### How it works

1. The input file is instrumented with `Binaryen.js`.  
   This is equivalent to running `wasm-opt` with `--log-execution`, `--instrument-memory`, `--instrument-locals` options.
2. Saves the instrumented wasm file along with the original, adding the `.inst` extension.
3. Runs the instrumented file with `Wasmer.js` + injected instrumentation handlers.
4. Writes the produced traces to `trace.log`.

