# wasm-trace
Instruments wasm files and traces execution, using **Binaryen.js** and **Wasmer.js**

Areas of application:
- Wasm/WASI debugging
- Wasm engine and runtime debugging
- Quality assurance and maintenance
- Security research
- Reverse engineering

### Install

```sh
npm install -g wasm-trace
```

### Example

```sh
$ wasm-trace -ELM ./test/hello.wasm
[tracer] Instrumenting and optimizing...
[tracer] Running WASI...
Hello WebAssembly!
[tracer] Processing...
```
The trace can be found in `trace.log`:
```log
     2 |     | enter _start {
     0 | i32 |   set    0 70784
    43 |     |   enter __wasilibc_init_preopen {
     6 |     |     enter malloc {
    38 | i32 |       get    0 16
    23 |     |       enter dlmalloc {
    39 | i32 |         set    1 70768
    40 | i32 |         get    0 16
     8 | i32 |         load   0+3424 0
    41 | i32 |         set    2 0
       |     |         ...
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

### Notes
- [`--execution`](https://github.com/WebAssembly/binaryen/blob/master/src/passes/LogExecution.cpp) logs execution at each function `entry`, `loop` header, and `return`
- [`--memory`](https://github.com/WebAssembly/binaryen/blob/master/src/passes/InstrumentMemory.cpp) intercepts all memory reads and writes
- [`--locals`](https://github.com/WebAssembly/binaryen/blob/master/src/passes/InstrumentLocals.cpp) intercepts all local reads and writes

**Note:** Currently this tool requires an experimental feature of Node.js: `wasm-bigint`.
It can be enabled globally or when running a single command:
```sh
node --experimental-wasm-bigint {command}
```
It's recommended to use the most recent version of Node.js.

### How it works

1. Analyzes the input wasm file (checks for `WASI`, instrumentation, etc.)
2. Instruments it using `Binaryen.js`
3. Saves the instrumented wasm file, if needed
4. Runs the instrumented file with injected instrumentation handlers
5. Writes CSV trace file
6. Post-processes the CSV trace file and produces a structured log file
