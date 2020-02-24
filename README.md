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
npm install -g wasm-trace
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
     2 | enter _start {
     0 |   set i32: 0 68256
    41 |   enter __wasilibc_init_preopen {
     4 |     enter malloc {
    32 |       get i32: 0 16
    21 |       enter dlmalloc {
    33 |         set i32: 1 68240
    34 |         get i32: 0 16
     5 |         load i32: 0+1056 0
    35 |         set i32: 2 0
    36 |         get i32: 0 16
    37 |         get i32: 0 16
    38 |         set i32: 3 32
    39 |         set i32: 4 4
    40 |         set i32: 0 0
    65 |         get i32: 3 32
   ... |         ...
```

### Usage

```log
wasm-trace.js [options] <file> [args..]

Options:
  --execution, -E    Instrument execution  [boolean]
  --locals, -L       Instrument locals  [boolean]
  --memory, -M       Instrument memory  [boolean]
  --optimize, --opt  Optimize after instrumenting  [boolean] [default: true]
  --output, -o       Output filename  [string] [default: "trace.log"]
  --save-wasm        Save instrumented wasm to ...  [string]
  --save-csv         Save csv log file to ...  [string]
  --process          Process csv log file  [string]
  --invoke, -i       Invoke a specified function  [string]
  --version          Show version number  [boolean]
  --help             Show help  [boolean]

Examples:
  wasm-trace.js -E ./test/hello.wasm                     Instrument, run and trace WASI app
  wasm-trace.js -ELM --invoke=fib ./test/fib32.wasm 20   Instrument, run and trace plain wasm file
  wasm-trace.js ./instrumented.wasm                      Run pre-instrumented wasm file
  wasm-trace.js --process=trace.csv ./instrumented.wasm  Just process an existing CSV trace file
```

### How it works

1. Analyzes the input wasm file (checks for `WASI`, instrumentation, etc.)
2. Instruments it using `Binaryen.js`
3. Saves the instrumented wasm file, if needed
4. Runs the instrumented file with injected instrumentation handlers
5. Writes CSV trace file
6. Post-processes the CSV trace file and produces a structured log file
