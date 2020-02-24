# wasm-trace
Instruments wasm files and traces execution, using **Binaryen.js** and **Wasmer.js**

- [`--execution`](https://github.com/WebAssembly/binaryen/blob/master/src/passes/LogExecution.cpp) logs execution at each function `entry`, `loop` header, and `return`
- [`--memory`](https://github.com/WebAssembly/binaryen/blob/master/src/passes/InstrumentMemory.cpp) intercepts all memory reads and writes
- [`--locals`](https://github.com/WebAssembly/binaryen/blob/master/src/passes/InstrumentLocals.cpp) intercepts all local reads and writes

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

### Example

```sh
$ wasm-trace -ELM ./test/hello.wasm
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

### Usage

```Log
wasm-trace.js [options] <file> [args..]

Options:
  --execution, -E    Instrument execution
  --locals, -L       Instrument locals
  --memory, -M       Instrument memory
  --optimize, --opt  Optimize after instrumenting  [boolean] [default: true]
  --output, -o       Output filename  [string] [default: "trace.log"]
  --save-wasm        Save instrumented wasm to ...  [string]
  --save-raw         Save raw log file to ...  [string]
  --process          Process raw log file  [string]
  --invoke, -i       Invoke a specified function  [string]
  --version          Show version number
  --help             Show help

Examples:
  wasm-trace.js -E ./test/hello.wasm                         Instrument, run and trace WASI app
  wasm-trace.js -ELM --invoke=fib ./test/fib32.wasm 20       Instrument, run and trace plain wasm file
  wasm-trace.js ./instrumented.wasm                          Run pre-instrumented wasm file
  wasm-trace.js --process=trace.raw.log ./instrumented.wasm  Just process an existing raw trace file
```

### How it works

1. Analyzes the input wasm file (checks for `WASI`, instrumentation, etc.)
2. Instruments it using `Binaryen.js`
3. Saves the instrumented wasm file, if needed
4. Runs the instrumented file with injected instrumentation handlers
5. Writes raw trace file
6. Post-processes the raw trace file and produces a structured log file
