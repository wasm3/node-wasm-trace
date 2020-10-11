# wasm-trace
Instruments wasm files using **Binaryen.js**, runs them and traces execution

### Areas of application
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

### How it works

1. Analyzes the input wasm file (checks for `WASI`, instrumentation, etc.)
2. Instruments it using `Binaryen.js`
3. Runs the instrumented file with injected instrumentation handlers
4. Writes CSV trace file
5. Post-processes the CSV trace file and produces a structured log file

Following **Binaryen** instrumentation passes are supported:
- [`--execution`](https://github.com/WebAssembly/binaryen/blob/master/src/passes/LogExecution.cpp) logs execution at each function `entry`, `loop` header, and `return`
- [`--memory`](https://github.com/WebAssembly/binaryen/blob/master/src/passes/InstrumentMemory.cpp) intercepts all memory reads and writes
- [`--locals`](https://github.com/WebAssembly/binaryen/blob/master/src/passes/InstrumentLocals.cpp) intercepts all local reads and writes

**`Instrumentation`, `execution` and `post-processing` stages are completely decoupled.**  
You can run each step separately:

1. Add instrumentation to a **wasm** binary file
```sh
node ./wasm-trace.js -ELM --save-wasm=./instrumented.wasm ./test/hello.wasm
```
Or using **Binaryen** directly:
```sh
wasm-opt --log-execution --instrument-memory --instrument-locals ./test/hello.wasm -o ./instrumented.wasm
```

2. Run instrumented wasm file
Wasm engine needs to support producing the `trace.csv` file.
For **Node.js**, this step currently requires enabling `bigint` and `wasi` features:
```sh
node --experimental-wasm-bigint --experimental-wasi-unstable-preview1 ./wasm-trace.js --save-csv=trace.csv ./instrumented.wasm
```
Or using **Wasm3**:
```sh
wasm3 ./instrumented.wasm    # The trace will be written to wasm3_trace.csv
```

3. Analyze/post-process the CSV trace file
```sh
node ./wasm-trace.js --process=trace.csv ./instrumented.wasm
```

It's recommended to use the most recent version of Node.js.

### Usage

```log
wasm-trace.js [options] <file> [args..]

Options:
  --execution, -E    Instrument execution  [boolean]
  --locals, -L       Instrument locals  [boolean]
  --memory, -M       Instrument memory  [boolean]
  --optimize, --opt  Optimize (use --no-opt to disable)  [boolean] [default: true]
  --output, -o       Output filename  [string] [default: "trace.log"]
  --save-wasm        Save instrumented wasm to ...  [string]
  --save-csv         Save CSV log file to ...  [string]
  --process          Process CSV log file  [string]
  --invoke, -i       Invoke a specified function  [string]
  --version          Show version number  [boolean]
  --help             Show help  [boolean]

Examples:
  wasm-trace.js -E ./test/hello.wasm                     Instrument, run and trace WASI app
  wasm-trace.js -ELM --invoke=fib ./test/fib32.wasm 20   Instrument, run and trace plain wasm file
  wasm-trace.js ./test/hello.instrumented.wasm           Run pre-instrumented wasm file
  wasm-trace.js --process=trace.csv ./instrumented.wasm  Just process an existing CSV trace file
```

