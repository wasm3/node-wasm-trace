# wasm-trace
Instruments wasm files and traces execution, using Binaryen.js and Wasmer.js

Currently this tool requires an experimental feature of Node.js: `wasm-bigint`.
It can be enabled globally or when running a single command:
```sh
node --experimental-wasm-bigint {command}
```
It's also recommended to use the most recent version of Node.

### Usage examples

```sh
$ ./wasm-trace.js ./test/hello.wasm
[tracer] Instrumenting...
[tracer] Running...
Hello WebAssembly!
```
The trace can be found in `trace.log`.

You can also pass arguments to WASI apps:
```sh
$ ./wasm-trace.js qjs.wasm fib.js 10
...
$ ./wasm-trace.js wasm3.wasm ./test/hello.wasm
...
```

### How it works

1. The input file is instrumented with `Binaryen.js`.
   This step is the same as using `wasm-opt` with `--log-execution`, `--instrument-memory`, `--instrument-locals` options.
2. Run the instrumented file with `Wasmer.js` + injected instrumentation handlers.
3. Write the produced traces to `trace.log`.

