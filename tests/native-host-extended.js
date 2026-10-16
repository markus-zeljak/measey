/* Measey — original expression parser and curve fitting, 2026.
 * Cavalry Magic Easing uses ExprTk-style mathematics with normalized input x.
 * Official examples: https://cavalry.studio/docs/user-interface/menus/window-menu/scene-window/time-editor/
 * Operator/function examples: https://cavalry.studio/docs/user-interface/menus/window-menu/attribute-editor/control-rows/control-rows-interaction/
 * This deliberately bounded preview grammar does not execute JavaScript.
 * ExprTk syntax reference: https://www.partow.net/programming/exprtk/
 * Supported: x (t alias), numeric literals, PI/E, arithmetic, ^, comparison,
 * logical operators, ?:, if(), mathematical functions and `var name := ...;`.
 * Full ExprTk loops, strings, vectors, assignment and user functions are not supported.
 */
var MeaseyMath = (function () {
    "use strict";
    var MAX_LENGTH = 12000;
    var MAX_TOKENS = 4096;
    var MAX_DEPTH = 128;
    var hasOwn = Object.prototype.hasOwnProperty;
    function own(object, key) { return hasOwn.call(object, key); }
    function finite(value) { return typeof value === "number" && isFinite(value); }
    function clamp(value, lo, hi) { return Math.max(lo, Math.min(hi, value)); }
    function trunc(value) { return value < 0 ? Math.ceil(value) : Math.floor(value); }
    function round(value) { return value < 0 ? -Math.floor(-value + 0.5) : Math.floor(value + 0.5); }
    function sign(value) { return value < 0 ? -1 : (value > 0 ? 1 : 0); }
    function sum() { var total = 0; for (var i = 0; i < arguments.length; i++) total += arguments[i]; return total; }
    var constants = {pi: Math.PI, e: Math.E, true: 1, false: 0};
    function builtin(fn, min, max) { return {fn: fn, min: min, max: max === undefined ? min : max}; }
    var functions = {
        abs: builtin(Math.abs, 1), acos: builtin(Math.acos, 1), asin: builtin(Math.asin, 1),
        atan: builtin(Math.atan, 1), atan2: builtin(Math.atan2, 2), ceil: builtin(Math.ceil, 1),
        acosh: builtin(function (v) { return Math.log(v + Math.sqrt(v * v - 1)); }, 1),
        asinh: builtin(function (v) { return sign(v) * Math.log(Math.abs(v) + Math.sqrt(v * v + 1)); }, 1),
        atanh: builtin(function (v) { return Math.log((1 + v) / (1 - v)) / 2; }, 1),
        avg: builtin(function () { return sum.apply(null, arguments) / arguments.length; }, 1, 64),
        cos: builtin(Math.cos, 1), cosh: builtin(function (v) { return (Math.exp(v) + Math.exp(-v)) / 2; }, 1),
        cot: builtin(function (v) { return 1 / Math.tan(v); }, 1),
        csc: builtin(function (v) { return 1 / Math.sin(v); }, 1),
        exp: builtin(Math.exp, 1), floor: builtin(Math.floor, 1),
        expm1: builtin(function (v) { if (Math.abs(v) > 0.001) return Math.exp(v) - 1; var total = v, term = v; for (var i = 2; i <= 8; i++) { term *= v / i; total += term; } return total; }, 1),
        frac: builtin(function (v) { return v - trunc(v); }, 1),
        ln: builtin(Math.log, 1), log: builtin(Math.log, 1),
        log10: builtin(function (v) { return Math.log(v) / Math.LN10; }, 1),
        log2: builtin(function (v) { return Math.log(v) / Math.LN2; }, 1),
        logn: builtin(function (v, base) { return Math.log(v) / Math.log(base); }, 2),
        log1p: builtin(function (v) { if (Math.abs(v) > 0.125) return Math.log(1 + v); var total = 0, term = v; for (var i = 1; i <= 24; i++) { total += term / i; term *= -v; } return total; }, 1),
        hypot: builtin(function (a, b) { var max = Math.max(Math.abs(a), Math.abs(b)); return max === 0 ? 0 : max * Math.sqrt((a / max) * (a / max) + (b / max) * (b / max)); }, 2),
        min: builtin(function () { return Math.min.apply(Math, arguments); }, 1, 64),
        max: builtin(function () { return Math.max.apply(Math, arguments); }, 1, 64),
        mod: builtin(function (a, b) { return a % b; }, 2),
        mul: builtin(function () { var product = 1; for (var i = 0; i < arguments.length; i++) product *= arguments[i]; return product; }, 1, 64),
        pow: builtin(Math.pow, 2), root: builtin(function (v, n) { return v < 0 && Math.abs(n % 2) === 1 ? -Math.pow(-v, 1 / n) : Math.pow(v, 1 / n); }, 2),
        round: builtin(round, 1), roundn: builtin(function (v, n) { var scale = Math.pow(10, n); return round(v * scale) / scale; }, 2),
        sec: builtin(function (v) { return 1 / Math.cos(v); }, 1),
        sgn: builtin(sign, 1), sign: builtin(sign, 1),
        sin: builtin(Math.sin, 1), sinh: builtin(function (v) { return (Math.exp(v) - Math.exp(-v)) / 2; }, 1),
        sinc: builtin(function (v) { return v === 0 ? 1 : Math.sin(v) / v; }, 1),
        sum: builtin(sum, 1, 64),
        sqrt: builtin(Math.sqrt, 1), tan: builtin(Math.tan, 1),
        tanh: builtin(function (v) { if (v > 20) return 1; if (v < -20) return -1; var q = Math.exp(2 * v); return (q - 1) / (q + 1); }, 1),
        trunc: builtin(trunc, 1),
        deg2rad: builtin(function (v) { return v * Math.PI / 180; }, 1),
        rad2deg: builtin(function (v) { return v * 180 / Math.PI; }, 1),
        deg2grad: builtin(function (v) { return v * 10 / 9; }, 1),
        grad2deg: builtin(function (v) { return v * 9 / 10; }, 1),
        clamp: builtin(function (lo, v, hi) { return clamp(v, lo, hi); }, 3),
        inrange: builtin(function (lo, v, hi) { return v >= lo && v <= hi ? 1 : 0; }, 3),
        equal: builtin(function (a, b) { return Math.abs(a - b) <= 1e-10 * Math.max(1, Math.abs(a), Math.abs(b)) ? 1 : 0; }, 2),
        not_equal: builtin(function (a, b) { return Math.abs(a - b) > 1e-10 * Math.max(1, Math.abs(a), Math.abs(b)) ? 1 : 0; }, 2),
        if: {min: 3, max: 3, lazy: true}
    };

    function tokenize(source) {
        if (typeof source !== "string" || !source.trim()) throw new Error("Enter a Magic Expression using x from 0 to 1.");
        if (source.length > MAX_LENGTH) throw new Error("Expression is too long (maximum 12,000 characters).");
        var tokens = [], p = 0, match;
        while (p < source.length) {
            var rest = source.slice(p);
            match = /^\s+/.exec(rest);
            if (match) { p += match[0].length; continue; }
            match = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
            if (match) {
                var number = Number(match[0]);
                if (!finite(number)) throw new Error("Non-finite number at character " + (p + 1) + ".");
                tokens.push({kind: "number", value: number, text: match[0], pos: p}); p += match[0].length;
            } else {
                match = /^[A-Za-z_][A-Za-z_0-9]*/.exec(rest);
                if (match) {
                    tokens.push({kind: "name", value: match[0].toLowerCase(), text: match[0], pos: p}); p += match[0].length;
                } else {
                    match = /^(?::=|<=|>=|==|!=|<>|&&|\|\||\*\*|[+\-*\/\%^<>=!?:(),;])/.exec(rest);
                    if (!match) throw new Error("Unsupported character '" + source.charAt(p) + "' at character " + (p + 1) + ".");
                    tokens.push({kind: "operator", value: match[0] === "**" ? "^" : match[0], text: match[0], pos: p}); p += match[0].length;
                }
            }
            if (tokens.length > MAX_TOKENS) throw new Error("Expression is too complex (maximum 4,096 tokens).");
        }
        // ExprTk permits 2x, 3(x + 1), and sin(x)cos(x). Insert explicit
        // multiplication so both the preview and host receive identical syntax.
        var expanded = [], words = {var: true, and: true, or: true, xor: true, nand: true, nor: true, xnor: true, not: true};
        for (var i = 0; i < tokens.length; i++) {
            var left = tokens[i], right = tokens[i + 1]; expanded.push(left);
            if (!right) continue;
            var leftEnd = left.kind === "number" || left.value === ")" || (left.kind === "name" && !own(words, left.value) && !own(functions, left.value));
            var rightStart = right.kind === "number" || right.value === "(" || (right.kind === "name" && !own(words, right.value));
            if (leftEnd && rightStart) expanded.push({kind: "operator", value: "*", text: "*", pos: right.pos});
        }
        if (expanded.length > MAX_TOKENS) throw new Error("Expression is too complex (maximum 4,096 tokens).");
        expanded.push({kind: "end", value: "<end>", text: "", pos: source.length});
        return expanded;
    }

    function Parser(tokens) { this.tokens = tokens; this.p = 0; this.depth = 0; this.variables = {}; }
    Parser.prototype.peek = function () { return this.tokens[this.p]; };
    Parser.prototype.take = function () { return this.tokens[this.p++]; };
    Parser.prototype.accept = function (value) { if (this.peek().value !== value) return false; this.take(); return true; };
    Parser.prototype.fail = function (message) { throw new Error(message + " at character " + (this.peek().pos + 1) + "."); };
    Parser.prototype.expect = function (value) { if (!this.accept(value)) this.fail("Expected '" + value + "'"); };
    Parser.prototype.expression = function () {
        if (++this.depth > MAX_DEPTH) this.fail("Expression nesting is too deep");
        var node = this.logicalOr();
        if (this.accept("?")) {
            var yes = this.expression(); this.expect(":");
            node = {type: "condition", test: node, yes: yes, no: this.expression()};
        }
        this.depth--; return node;
    };
    function binaryLevel(method, next, operators) {
        Parser.prototype[method] = function () {
            var node = this[next]();
            while (operators.indexOf(this.peek().value) !== -1) {
                var op = this.take().value;
                node = {type: "binary", op: op, left: node, right: this[next]()};
            }
            return node;
        };
    }
    binaryLevel("logicalOr", "logicalAnd", ["or", "||", "xor", "nor", "xnor"]);
    binaryLevel("logicalAnd", "comparison", ["and", "&&", "nand"]);
    binaryLevel("comparison", "additive", ["<", "<=", ">", ">=", "=", "==", "!=", "<>"]);
    binaryLevel("additive", "multiplicative", ["+", "-"]);
    binaryLevel("multiplicative", "unary", ["*", "/", "%"]);
    Parser.prototype.unary = function () {
        var op = this.peek().value;
        if (op === "+" || op === "-" || op === "!" || op === "not") {
            this.take();
            if (++this.depth > MAX_DEPTH) this.fail("Expression nesting is too deep");
            var node = {type: "unary", op: op, arg: this.unary()}; this.depth--; return node;
        }
        return this.power();
    };
    Parser.prototype.power = function () {
        var node = this.primary();
        if (this.accept("^")) {
            if (++this.depth > MAX_DEPTH) this.fail("Expression nesting is too deep");
            node = {type: "binary", op: "^", left: node, right: this.unary()}; this.depth--;
        }
        return node;
    };
    Parser.prototype.primary = function () {
        var token = this.take();
        if (token.kind === "number") return {type: "number", value: token.value};
        if (token.value === "(") { var node = this.expression(); this.expect(")"); return node; }
        if (token.kind !== "name") { this.p--; this.fail("Expected a number, x or a mathematical function"); }
        var name = token.value;
        if (this.accept("(")) {
            if (!own(functions, name)) { this.p--; this.fail("Unsupported function '" + name + "'"); }
            var args = [];
            if (!this.accept(")")) { do { args.push(this.expression()); } while (this.accept(",")); this.expect(")"); }
            var spec = functions[name];
            if (args.length < spec.min || args.length > spec.max) this.fail("Function '" + name + "' expects " + spec.min + (spec.max !== spec.min ? "–" + spec.max : "") + " arguments");
            return {type: "call", name: name, args: args};
        }
        if (name === "x" || name === "t") return {type: "input"};
        if (own(constants, name)) return {type: "number", value: constants[name]};
        if (own(this.variables, name)) return {type: "variable", name: name};
        this.p--; this.fail("Unknown variable '" + name + "' (use x for progress)");
    };
    Parser.prototype.program = function () {
        var declarations = [];
        while (this.accept("var")) {
            if (declarations.length >= 64) this.fail("Too many variables (maximum 64)");
            var token = this.take(), name = token.value;
            if (token.kind !== "name" || name === "x" || name === "t" || name === "var" || own(constants, name) || own(functions, name) || own(this.variables, name) || name === "__proto__" || name === "constructor" || name === "prototype") this.fail("Choose a distinct mathematical variable name");
            this.expect(":=");
            var value = this.expression(); this.expect(";");
            declarations.push({name: name, value: value}); this.variables[name] = true;
        }
        var result = this.expression(); this.accept(";");
        if (this.peek().kind !== "end") this.fail("Unexpected '" + this.peek().text + "'");
        return {declarations: declarations, result: result};
    };

    function evaluate(node, x, vars, budget) {
        if (--budget.count < 0) throw new Error("Expression evaluation limit reached.");
        var a, b, op;
        if (node.type === "number") return node.value;
        if (node.type === "input") return x;
        if (node.type === "variable") return vars[node.name];
        if (node.type === "unary") {
            a = evaluate(node.arg, x, vars, budget);
            return node.op === "+" ? a : (node.op === "-" ? -a : (a ? 0 : 1));
        }
        if (node.type === "condition") return evaluate(evaluate(node.test, x, vars, budget) ? node.yes : node.no, x, vars, budget);
        if (node.type === "call") {
            if (node.name === "if") return evaluate(evaluate(node.args[0], x, vars, budget) ? node.args[1] : node.args[2], x, vars, budget);
            var args = []; for (var i = 0; i < node.args.length; i++) args.push(evaluate(node.args[i], x, vars, budget));
            return functions[node.name].fn.apply(null, args);
        }
        a = evaluate(node.left, x, vars, budget); op = node.op;
        if ((op === "and" || op === "&&") && !a) return 0;
        if ((op === "or" || op === "||") && a) return 1;
        b = evaluate(node.right, x, vars, budget);
        if (op === "+") return a + b;
        if (op === "-") return a - b;
        if (op === "*") return a * b;
        if (op === "/") return a / b;
        if (op === "%") return a % b;
        if (op === "^") return Math.pow(a, b);
        if (op === "<") return a < b ? 1 : 0;
        if (op === "<=") return a <= b ? 1 : 0;
        if (op === ">") return a > b ? 1 : 0;
        if (op === ">=") return a >= b ? 1 : 0;
        if (op === "=" || op === "==") return a === b ? 1 : 0;
        if (op === "!=" || op === "<>") return a !== b ? 1 : 0;
        if (op === "and" || op === "&&") return a && b ? 1 : 0;
        if (op === "or" || op === "||") return a || b ? 1 : 0;
        if (op === "xor") return !!a !== !!b ? 1 : 0;
        if (op === "nand") return a && b ? 0 : 1;
        if (op === "nor") return a || b ? 0 : 1;
        if (op === "xnor") return !!a === !!b ? 1 : 0;
        throw new Error("Unsupported operator.");
    }

    function compile(expression) {
        var tokens = tokenize(expression), program = new Parser(tokens).program();
        // Canonical ExprTk source. Names are case-insensitive in the preview;
        // PI/E retain the documented uppercase constants when passed to Cavalry.
        var hostTokens = [];
        for (var i = 0; i < tokens.length - 1; i++) {
            var token = tokens[i], v = token.value;
            var normalized = v === "t" ? "x" : v === "pi" ? "PI" : v === "e" ? String(Math.E) : v === "true" ? "1" : v === "false" ? "0" : v === "ln" ? "log" : v === "sign" ? "sgn" : v;
            hostTokens.push(token.kind === "name" ? normalized : (v === "&&" ? "and" : v === "||" ? "or" : v === "!" ? "not" : v === "^" ? "^" : token.text));
        }
        var fn = function (x) {
            if (!finite(x)) throw new Error("Progress must be a finite number.");
            var vars = {}, budget = {count: 20000};
            for (var j = 0; j < program.declarations.length; j++) { var d = program.declarations[j]; vars[d.name] = evaluate(d.value, x, vars, budget); }
            var result = evaluate(program.result, x, vars, budget);
            if (!finite(result)) throw new Error("Expression is not finite at x = " + x.toFixed(6) + ".");
            return result;
        };
        fn.expression = hostTokens.join(" "); fn.source = expression;
        return fn;
    }
    function sample(fn, count) {
        if (typeof fn === "string") fn = compile(fn);
        count = Math.max(2, Math.min(4097, finite(count) ? Math.floor(count) : 129));
        var points = [];
        for (var i = 0; i < count; i++) { var x = i / (count - 1), y = fn(x); if (!finite(y)) throw new Error("Expression is not finite at x = " + x.toFixed(6) + "."); points.push({x: x, y: y}); }
        return points;
    }
    function validate(expression, count) {
        try { var fn = compile(expression); return {ok: true, compiled: fn, expression: fn.expression, samples: sample(fn, count)}; }
        catch (error) { return {ok: false, error: error.message || String(error)}; }
    }
    function cubic(s, p1, p2) { var r = 1 - s; return 3 * r * r * s * p1 + 3 * r * s * s * p2 + s * s * s; }
    function parameterAtX(x, x1, x2) {
        if (x <= 0) return 0; if (x >= 1) return 1;
        var lo = 0, hi = 1, s = x;
        for (var i = 0; i < 24; i++) {
            var error = cubic(s, x1, x2) - x;
            if (Math.abs(error) < 1e-10) break;
            if (error > 0) hi = s; else lo = s;
            var r = 1 - s;
            var slope = 3 * r * r * x1 + 6 * r * s * (x2 - x1) + 3 * s * s * (1 - x2);
            var next = Math.abs(slope) > 1e-10 ? s - error / slope : (lo + hi) / 2;
            s = next > lo && next < hi ? next : (lo + hi) / 2;
        }
        return s;
    }
    function bezierValue(x, handles) { return cubic(parameterAtX(x, handles.x1, handles.x2), handles.y1, handles.y2); }
    function fitAtX(points, x1, x2) {
        var aa = 0, ab = 0, bb = 0, ar = 0, br = 0, rows = [], valueScale = 1;
        for (var k = 0; k < points.length; k++) valueScale = Math.max(valueScale, Math.abs(points[k].y));
        for (var i = 1; i < points.length - 1; i++) {
            var s = parameterAtX(points[i].x, x1, x2), r = 1 - s;
            var a = 3 * r * r * s, b = 3 * r * s * s, target = points[i].y / valueScale - s * s * s / valueScale;
            aa += a * a; ab += a * b; bb += b * b; ar += a * target; br += b * target;
            rows.push({a: a, b: b, target: target});
        }
        var determinant = aa * bb - ab * ab;
        if (Math.abs(determinant) < 1e-14) return null;
        var y1 = (ar * bb - br * ab) / determinant, y2 = (br * aa - ar * ab) / determinant, error = 0;
        if (!finite(y1) || !finite(y2)) return null;
        for (var j = 0; j < rows.length; j++) { var row = rows[j], e = row.a * y1 + row.b * y2 - row.target; error += e * e; }
        y1 *= valueScale; y2 *= valueScale;
        if (!finite(y1) || !finite(y2)) return null;
        return {x1: x1, y1: y1, x2: x2, y2: y2, error: error};
    }
    function fitBezier(fn, options) {
        options = options || {};
        if (typeof fn === "string") fn = compile(fn);
        var points = sample(fn, options.sampleCount || 81);
        var best = fitAtX(points, 1 / 3, 2 / 3);
        if (!best) throw new Error("This curve could not be fitted to Bézier handles.");
        if (options.optimizeX !== false && best.error > 1e-18) {
            var seeds = [0.02, 0.18, 1 / 3, 0.5, 2 / 3, 0.82, 0.98];
            for (var i = 0; i < seeds.length; i++) for (var j = 0; j < seeds.length; j++) {
                var candidate = fitAtX(points, seeds[i], seeds[j]);
                if (candidate && candidate.error < best.error) best = candidate;
            }
            var steps = [0.12, 0.04, 0.012, 0.004, 0.0012, 0.0004];
            for (var k = 0; k < steps.length; k++) {
                for (var iter = 0; iter < 24; iter++) {
                    var prior = best, step = steps[k];
                    for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) {
                        if (!dx && !dy) continue;
                        var next = fitAtX(points, clamp(prior.x1 + dx * step, 0.0001, 0.9999), clamp(prior.x2 + dy * step, 0.0001, 0.9999));
                        if (next && next.error < best.error) best = next;
                    }
                    if (best === prior) break;
                }
            }
        }
        var dense = sample(fn, 257), squared = 0, maxError = 0, deltas = [];
        for (var d = 0; d < dense.length; d++) {
            var delta = bezierValue(dense[d].x, best) - dense[d].y;
            if (!finite(delta)) throw new Error("This curve exceeds the finite range of Bézier handles.");
            deltas.push(delta); maxError = Math.max(maxError, Math.abs(delta));
        }
        if (maxError > 0) for (var e = 0; e < deltas.length; e++) squared += Math.pow(deltas[e] / maxError, 2);
        best.rmsError = maxError * Math.sqrt(squared / dense.length); best.maxError = maxError;
        best.endpointMismatch = Math.max(Math.abs(points[0].y), Math.abs(points[points.length - 1].y - 1));
        delete best.error;
        return best;
    }
    function powerExpression(power, type) {
        if (!finite(power) || power <= 0 || power > 100) throw new Error("Power must be a finite number greater than 0 and no greater than 100.");
        type = type === undefined ? "in" : String(type).toLowerCase().trim().replace(/\s+/g, " ");
        if (type !== "in" && type !== "out" && type !== "in out") throw new Error("Choose power easing type: in, out or in out.");
        if (power === 1) return "x";
        var n = String(power);
        if (type === "in") return "pow(x, " + n + ")";
        if (type === "out") return "1 - pow(1 - x, " + n + ")";
        return "x < 0.5 ? pow(2 * x, " + n + ") / 2 : 1 - pow(2 * (1 - x), " + n + ") / 2";
    }
    function defaults() {
        var presets = [{id: "clear", name: "NONE / CLEAR", type: "", expression: "x", clear: true}];
        var types = ["in", "out", "in out"];
        for (var power = 1; power <= 10; power++) {
            for (var t = 0; t < types.length; t++) presets.push({id: "power-" + power + "-" + types[t].replace(/ /g, "-"), name: "POWER " + power, type: types[t], expression: powerExpression(power, types[t]), power: power, clear: false});
        }
        return presets;
    }
    return {compile: compile, validate: validate, sample: sample, bezierValue: bezierValue, fitBezier: fitBezier, powerExpression: powerExpression, defaults: defaults, finite: finite};
}());
if (typeof module !== "undefined" && module.exports) module.exports = MeaseyMath;

/* Measey — original Cavalry keyframe adapter, 2026.
 * Target: Cavalry 2.7.2; editor/UI api only.
 * Verified API signatures: installed assets/MetaData/api_function_metadata.json
 * and https://cavalry.studio/docs/tech-info/scripting/api-module/
 * Magic fallback data fields easing/exprEasing/numValue verified in Cavalry.
 * Keyframe data.colorId writing and readback verified in Cavalry 2.7.2.
 */
var MeaseyHost = (function () {
    "use strict";
    var active = 0;
    var NONE = "None";
    var PLUM = 11;
    var SILVER = 16;
    var lastSnapshot = null;
    function finite(v) { return typeof v === "number" && isFinite(v); }
    function clone(v) { return JSON.parse(JSON.stringify(v)); }
    function mathModule(math) { return math || (typeof MeaseyMath !== "undefined" ? MeaseyMath : null); }
    function guarded(fn) { active++; try { return fn(); } finally { active--; } }
    function dictionary(attr, object) { var result = {}; result[attr] = object; return result; }
    function parsePath(path) {
        var hash = path.indexOf("#");
        var split = path.indexOf(".", hash < 0 ? 0 : hash);
        return split < 0 ? null : {layerId: path.slice(0, split), attrId: path.slice(split + 1)};
    }
    function readData(id) { var data = api.get(id, "data"); return data && typeof data === "object" ? clone(data) : {}; }
    function restoreKey(key) {
        try { api.set(key.id, {data: clone(key.data)}); }
        catch (e) { /* The operation error is still reported to the panel. */ }
    }
    function magicOf(key) {
        if (typeof api.getMagicEasing === "function") {
            try {
                var nativeMagic = api.getMagicEasing(key.layerId, key.attrId, key.frame);
                if (nativeMagic) return {name: nativeMagic.easingName || NONE, easingName: nativeMagic.easingName || NONE, expression: nativeMagic.expression || "", active: !!nativeMagic.easingName && nativeMagic.easingName !== NONE};
            } catch (e) { /* 2.7 uses the keyData fallback below. */ }
        }
        var expression = typeof key.data.exprEasing === "string" ? key.data.exprEasing : "";
        var enabled = key.data.easing !== undefined && key.data.easing !== null && key.data.easing !== 0;
        return {name: enabled ? (expression ? "Custom" : "Magic Easing") : NONE,
            easingName: enabled ? (expression ? "Custom" : "Magic Easing") : NONE,
            expression: enabled ? expression : "", active: enabled, enumValue: key.data.easing};
    }
    function keyAt(id, layer, attr, frame) {
        var key = {id: id, layerId: layer, attrId: attr, frame: frame, data: readData(id)};
        key.value = key.data.numValue;
        key.magic = magicOf(key);
        return key;
    }
    function pairedPosition(segment) {
        if (segment.attrId !== "position.x" && segment.attrId !== "position.y") return false;
        var sibling = segment.attrId === "position.x" ? "position.y" : "position.x";
        try {
            var times = api.getKeyframeTimes(segment.layerId, sibling) || [];
            return times.indexOf(segment.startFrame) >= 0 && times.indexOf(segment.endFrame) >= 0;
        } catch (e) { return false; }
    }
    function pathGeometry(segment) {
        var axes = ["position.x", "position.y"], geometry = [];
        for (var a = 0; a < axes.length; a++) {
            var frames = api.getKeyframeTimes(segment.layerId, axes[a]) || [];
            var ids = api.getKeyframeIdsForAttribute(segment.layerId, axes[a]) || [];
            var endpoints = [segment.startFrame, segment.endFrame];
            for (var b = 0; b < endpoints.length; b++) {
                var index = frames.indexOf(endpoints[b]);
                if (index >= 0 && ids[index]) geometry.push({id: ids[index], attrId: axes[a], frame: endpoints[b], data: readData(ids[index])});
            }
        }
        return geometry;
    }
    function samplePositions(segment, count) {
        var saved = api.getFrame(), points = [];
        try {
            var steps = Math.max(1, Math.min(count - 1, segment.duration)), prior = null;
            for (var i = 0; i <= steps; i++) {
                var frame = Math.round(segment.startFrame + segment.duration * i / steps);
                if (frame === prior) continue; prior = frame;
                api.setFrame(frame);
                var x = api.get(segment.layerId, "position.x"), y = api.get(segment.layerId, "position.y");
                if (!finite(x) || !finite(y)) throw new Error("The motion path cannot be sampled.");
                points.push({frame: frame, x: x, y: y, time: (frame - segment.startFrame) / segment.duration});
            }
        } finally { api.setFrame(saved); }
        return points;
    }
    function neighboringKey(segment, frame, direction) {
        var frames = api.getKeyframeTimes(segment.layerId, segment.attrId) || [];
        var ids = api.getKeyframeIdsForAttribute(segment.layerId, segment.attrId) || [];
        var found = -1;
        for (var i = 0; i < frames.length; i++) {
            if (direction < 0 && frames[i] < frame && (found < 0 || frames[i] > frames[found])) found = i;
            if (direction > 0 && frames[i] > frame && (found < 0 || frames[i] < frames[found])) found = i;
        }
        return found < 0 ? null : {frame: frames[found], data: readData(ids[found])};
    }
    function writeBezier(segment, fit, position) {
        var originalStart = readData(segment.a.id), originalEnd = readData(segment.b.id);
        var previous = neighboringKey(segment, segment.startFrame, -1), following = neighboringKey(segment, segment.endFrame, 1);
        if (originalEnd.interpolation === 2 && following) throw new Error("The following span is Step; keep Magic to preserve that hold.");
        api.modifyKeyframe(segment.layerId, dictionary(segment.attrId, {frame: segment.startFrame, type: 0}));
        api.modifyKeyframe(segment.layerId, dictionary(segment.attrId, {frame: segment.endFrame, type: 0}));
        var unlockedStart = readData(segment.a.id), unlockedEnd = readData(segment.b.id);
        unlockedStart.locked = false; unlockedStart.weightLocked = false;
        unlockedEnd.locked = false; unlockedEnd.weightLocked = false;
        // Restore the untouched sides if changing interpolation initialized them.
        if (originalStart.leftBez) unlockedStart.leftBez = clone(originalStart.leftBez);
        if (originalEnd.rightBez) unlockedEnd.rightBez = clone(originalEnd.rightBez);
        api.set(segment.a.id, {data: unlockedStart}); api.set(segment.b.id, {data: unlockedEnd});
        if (!position && typeof api.clearKeyframeVelocity === "function") {
            api.clearKeyframeVelocity(segment.layerId, dictionary(segment.attrId, {frame: segment.startFrame}));
            api.clearKeyframeVelocity(segment.layerId, dictionary(segment.attrId, {frame: segment.endFrame}));
        }
        var delta = segment.endValue - segment.startValue;
        var y1 = finite(fit.handleValue1) ? fit.handleValue1 : segment.startValue + fit.y1 * delta;
        var y2 = finite(fit.handleValue2) ? fit.handleValue2 : segment.startValue + fit.y2 * delta;
        api.modifyKeyframeTangent(segment.layerId, dictionary(segment.attrId, {frame: segment.startFrame, outHandle: true, inHandle: false, angleLocked: false, weightLocked: false,
            xValue: segment.startFrame + fit.x1 * segment.duration, yValue: y1}));
        api.modifyKeyframeTangent(segment.layerId, dictionary(segment.attrId, {frame: segment.endFrame, inHandle: true, outHandle: false, angleLocked: false, weightLocked: false,
            xValue: segment.startFrame + fit.x2 * segment.duration, yValue: y2}));
        if (position) {
            // Cavalry 2.7 honors position Bezier handles when facing speeds are 1.
            // Seed all velocity fields while preserving the neighboring sides.
            api.setKeyframeVelocity(segment.layerId, dictionary(segment.attrId, {frame: segment.startFrame,
                rightSpeed: 1, rightInfluence: 0.333,
                leftSpeed: finite(originalStart.leftSpeed) ? originalStart.leftSpeed : 1,
                leftInfluence: finite(originalStart.leftInfluence) ? originalStart.leftInfluence : 0.333}));
            api.setKeyframeVelocity(segment.layerId, dictionary(segment.attrId, {frame: segment.endFrame,
                leftSpeed: 1, leftInfluence: 0.333,
                rightSpeed: finite(originalEnd.rightSpeed) ? originalEnd.rightSpeed : 1,
                rightInfluence: finite(originalEnd.rightInfluence) ? originalEnd.rightInfluence : 0.333}));
        }
        // A native key's interpolation flag controls both tangent sides. Keep the
        // fitted endpoints Bezier; reproduce a neighboring Linear tangent explicitly.
        // Preserve neighboring Magic flags and existing outer handle/velocity data.
        var currentStart = readData(segment.a.id), currentEnd = readData(segment.b.id);
        var startFields = ["leftBez", "leftSpeed", "leftInfluence"];
        var endFields = ["rightBez", "rightSpeed", "rightInfluence", "easing", "exprEasing"];
        for (var sf = 0; sf < startFields.length; sf++) {
            var sk = startFields[sf];
            if (originalStart[sk] === undefined) delete currentStart[sk]; else currentStart[sk] = clone(originalStart[sk]);
        }
        for (var ef = 0; ef < endFields.length; ef++) {
            var ek = endFields[ef];
            if (originalEnd[ek] === undefined) delete currentEnd[ek]; else currentEnd[ek] = clone(originalEnd[ek]);
        }
        if ((originalStart.interpolation === undefined || originalStart.interpolation === 1) && previous && finite(previous.data.numValue)) {
            currentStart.leftBez = {x: 0, y: 0};
        }
        if ((originalEnd.interpolation === undefined || originalEnd.interpolation === 1) && following && finite(following.data.numValue)) {
            currentEnd.rightBez = {x: 0, y: 0};
        }
        currentStart.interpolation = 0; currentEnd.interpolation = 0;
        api.set(segment.a.id, {data: currentStart}); api.set(segment.b.id, {data: currentEnd});
    }
    function axisSegment(geometry, segment, attr) {
        var a = null, b = null;
        for (var i = 0; i < geometry.length; i++) if (geometry[i].attrId === attr) {
            if (geometry[i].frame === segment.startFrame) a = keyAt(geometry[i].id, segment.layerId, attr, segment.startFrame);
            else b = keyAt(geometry[i].id, segment.layerId, attr, segment.endFrame);
        }
        if (!a || !b) throw new Error("The linked position channel cannot be read.");
        return {a: a, b: b, layerId: segment.layerId, attrId: attr, startFrame: segment.startFrame, endFrame: segment.endFrame,
            duration: segment.duration, startValue: a.value, endValue: b.value, magic: a.magic, isMotionPath: true};
    }
    function fitAxis(segment, points, math, preferred) {
        if (segment.magic.expression) return math.fitBezier(math.compile(segment.magic.expression), {optimizeX: true});
        var delta = segment.endValue - segment.startValue, axis = segment.attrId === "position.x" ? "x" : "y";
        if (Math.abs(delta) > 1e-12) {
            var samples = points.map(function (p) { return {x: p.time, y: (p[axis] - segment.startValue) / delta}; });
            return math.fitBezier(interpolate(samples), {optimizeX: true});
        }
        // Equal endpoint values can still describe an ordinary curved channel.
        // Retain its time handles and solve the two value handles against samples.
        var a = segment.a.data, b = segment.b.data;
        var x1 = a.rightBez ? Math.max(0, Math.min(1, a.rightBez.x / segment.duration)) : preferred.x1;
        var x2 = b.leftBez ? Math.max(0, Math.min(1, 1 + b.leftBez.x / segment.duration)) : preferred.x2;
        var aa = 0, ab = 0, bb = 0, av = 0, bv = 0;
        function parameter(x) {
            var lo = 0, hi = 1;
            for (var i = 0; i < 45; i++) { var t = (lo + hi) / 2, u = 1 - t, value = 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t; if (value < x) lo = t; else hi = t; }
            return (lo + hi) / 2;
        }
        for (var i = 0; i < points.length; i++) {
            var t = parameter(points[i].time), u = 1 - t, w1 = 3 * u * u * t, w2 = 3 * u * t * t;
            var residual = points[i][axis] - (u * u * u * segment.startValue + t * t * t * segment.endValue);
            aa += w1 * w1; ab += w1 * w2; bb += w2 * w2; av += w1 * residual; bv += w2 * residual;
        }
        var determinant = aa * bb - ab * ab;
        var v1 = determinant > 1e-12 ? (av * bb - bv * ab) / determinant : segment.startValue;
        var v2 = determinant > 1e-12 ? (bv * aa - av * ab) / determinant : segment.endValue;
        return {x1: x1, x2: x2, y1: 0, y2: 1, handleValue1: v1, handleValue2: v2, endpointMismatch: 0, maxError: 0, rmsError: 0};
    }
    function flattenPosition(segment, fit, math, geometry, target) {
        var axes = ["position.x", "position.y"], fits = [];
        for (var i = 0; i < axes.length; i++) {
            var axis = axisSegment(geometry, segment, axes[i]);
            var curve = fitAxis(axis, target, math, fit);
            if (curve.endpointMismatch > 0.0001) throw new Error("Curve endpoints must be 0 and 1 to flatten.");
            if (axis.magic.active) api.magicEasing(axis.layerId, axis.attrId, axis.startFrame, NONE);
            writeBezier(axis, curve, true); fits.push({segment: axis, curve: curve});
        }
        var actual = samplePositions(segment, target.length), scale = 1, maxError = 0;
        var first = target[0];
        for (var j = 0; j < target.length; j++) scale = Math.max(scale, Math.sqrt(Math.pow(target[j].x - first.x, 2) + Math.pow(target[j].y - first.y, 2)));
        for (var k = 0; k < actual.length; k++) maxError = Math.max(maxError, Math.sqrt(Math.pow(actual[k].x - target[k].x, 2) + Math.pow(actual[k].y - target[k].y, 2)) / scale);
        if (maxError > 0.06) throw new Error("This position animation cannot be matched closely by one Bezier curve (" + (maxError * 100).toFixed(1) + "% error).");
        fit.maxError = Math.max(fit.maxError, maxError);
        return {fits: fits, maxError: maxError};
    }
    function sampleHost(segment, count) {
        if (!finite(segment.startValue) || !finite(segment.endValue)) return null;
        var savedFrame = api.getFrame();
        var points = [];
        var delta = segment.endValue - segment.startValue;
        if (Math.abs(delta) < 1e-12) return null;
        try {
            var steps = Math.max(1, Math.min(count - 1, segment.duration));
            var previousFrame = null;
            for (var i = 0; i <= steps; i++) {
                var frame = Math.round(segment.startFrame + segment.duration * i / steps);
                if (frame === previousFrame) continue;
                previousFrame = frame;
                api.setFrame(frame);
                var value = api.get(segment.layerId, segment.attrId);
                if (!finite(value)) return null;
                points.push({x: (frame - segment.startFrame) / segment.duration, y: (value - segment.startValue) / delta});
            }
        } finally { api.setFrame(savedFrame); }
        return points;
    }
    function interpolate(points) {
        return function (x) {
            if (x <= points[0].x) return points[0].y;
            for (var i = 1; i < points.length; i++) if (x <= points[i].x) {
                var a = points[i - 1], b = points[i], t = (x - a.x) / (b.x - a.x);
                return a.y + (b.y - a.y) * t;
            }
            return points[points.length - 1].y;
        };
    }
    function segmentCurve(segment, math, includeSamples) {
        var expression = segment.magic.expression;
        var result = {keyId: segment.a.id, expression: expression, magic: segment.magic.active,
            layerId: segment.layerId, attrId: segment.attrId, startFrame: segment.startFrame, endFrame: segment.endFrame, samples: null};
        if (!math || !includeSamples) return result;
        if (expression) {
            try { result.samples = math.sample(expression, 129); return result; }
            catch (e) { result.error = e.message; }
        }
        var a = segment.a.data, b = segment.b.data;
        if (!segment.magic.active && !segment.isMotionPath && finite(segment.startValue) && finite(segment.endValue)) {
            var delta = segment.endValue - segment.startValue;
            if (a.interpolation === 2) {
                result.samples = [{x: 0, y: 0}, {x: 0.999999, y: 0}, {x: 1, y: 1}];
            } else if (a.interpolation === 1 || Math.abs(delta) < 1e-12 || (!a.rightBez && !b.leftBez)) {
                result.samples = [{x: 0, y: 0}, {x: 1, y: 1}];
            } else {
                var outgoing = a.rightBez || {x: segment.duration / 3, y: delta / 3};
                var incoming = b.leftBez || {x: -segment.duration / 3, y: -delta / 3};
                result.bezier = {x1: outgoing.x / segment.duration, y1: outgoing.y / delta,
                    x2: 1 + incoming.x / segment.duration, y2: 1 + incoming.y / delta};
                result.samples = math.sample(function (x) { return math.bezierValue(x, result.bezier); }, 129);
            }
            return result;
        }
        result.samples = sampleHost(segment, 129);
        if (!result.samples && expression) result.error = result.error || "This expression cannot be previewed.";
        return result;
    }
    function readSelection(math, options) {
        math = mathModule(math); options = options || {};
        return guarded(function () {
            var selection = api.getSelectedKeyframes() || {};
            var selectedIds = api.getSelectedKeyframeIds() || [];
            var idLookup = {}, keys = [], segments = [], errors = [], groups = [];
            for (var id = 0; id < selectedIds.length; id++) idLookup[selectedIds[id]] = true;
            var paths = Object.keys(selection);
            for (var p = 0; p < paths.length; p++) {
                var parsed = parsePath(paths[p]);
                if (!parsed) { errors.push("An invalid attribute path was skipped."); continue; }
                try {
                    if (typeof api.layerExists === "function" && !api.layerExists(parsed.layerId)) continue;
                    var times = api.getKeyframeTimes(parsed.layerId, parsed.attrId) || [];
                    var ids = api.getKeyframeIdsForAttribute(parsed.layerId, parsed.attrId) || [];
                    var frameIds = {};
                    for (var ti = 0; ti < times.length; ti++) if (ids[ti]) frameIds[times[ti]] = ids[ti];
                    var sortedTimes = times.slice().sort(function (a, b) { return a - b; });
                    var frames = selection[paths[p]].slice().sort(function (a, b) { return a - b; });
                    var group = {layerId: parsed.layerId, attrId: parsed.attrId, frames: frames, keys: []};
                    for (var f = 0; f < frames.length; f++) {
                        var frame = frames[f], keyId = frameIds[frame];
                        if (!keyId || (selectedIds.length && !idLookup[keyId])) continue;
                        var key = keyAt(keyId, parsed.layerId, parsed.attrId, frame);
                        keys.push(key); group.keys.push(key);
                        var nextIndex = sortedTimes.indexOf(frame) + 1;
                        if (nextIndex <= 0 || nextIndex >= sortedTimes.length) continue;
                        var nextFrame = sortedTimes[nextIndex], nextId = frameIds[nextFrame];
                        if (!nextId) continue;
                        var next = keyAt(nextId, parsed.layerId, parsed.attrId, nextFrame);
                        var segment = {a: key, b: next, layerId: parsed.layerId, attrId: parsed.attrId,
                            startFrame: frame, endFrame: nextFrame, startValue: key.value, endValue: next.value,
                            duration: nextFrame - frame, magic: key.magic};
                        segment.isMotionPath = pairedPosition(segment);
                        segments.push(segment);
                    }
                    groups.push(group);
                } catch (e) { errors.push(parsed.attrId + ": " + e.message); }
            }
            var expressions = [], magicNames = [];
            // The terminal key has no outgoing interval. Its stored flag should
            // not make an otherwise uniform selected interval look mixed.
            var representativeKeys = segments.length ? segments.map(function (s) { return s.a; }) : keys;
            for (var ki = 0; ki < representativeKeys.length; ki++) {
                var representative = representativeKeys[ki];
                var expr = representative.magic.expression || (representative.magic.active ? "" : "x");
                if (expressions.indexOf(expr) < 0) expressions.push(expr);
                if (magicNames.indexOf(representative.magic.name) < 0) magicNames.push(representative.magic.name);
            }
            var curves = [];
            for (var si = 0; si < Math.min(segments.length, 12); si++) curves.push(segmentCurve(segments[si], math, options.samples !== false));
            var snapshot = {keys: keys, segments: segments, groups: groups, count: keys.length,
                selectedIds: keys.map(function (k) { return k.id; }), expression: expressions.length === 1 ? expressions[0] : "",
                curveExpression: segments.length ? segments[0].magic.expression : (expressions[0] || "x"),
                mixed: expressions.length > 1 || magicNames.length > 1, previewCurves: curves, curves: curves,
                errors: errors, activeComp: api.getActiveComp(),
                message: keys.length ? keys.length + " keyframe" + (keys.length === 1 ? "" : "s") + " selected" + (segments.length ? " · " + segments.length + " outgoing curve" + (segments.length === 1 ? "" : "s") : " · final keyframe") : "Select keyframes to preview their curves."};
            if (!curves.length && keys.length && keys[0].magic.expression && math && options.samples !== false) {
                try { snapshot.previewCurves.push({keyId: keys[0].id, expression: keys[0].magic.expression, magic: true, samples: math.sample(keys[0].magic.expression, 129)}); } catch (e) {}
            }
            lastSnapshot = snapshot;
            return snapshot;
        });
    }
    function result(changed, skipped, errors, extra) {
        var output = {changed: changed, skipped: skipped, errors: errors || [], ok: changed > 0};
        var names = Object.keys(extra || {}); for (var i = 0; i < names.length; i++) output[names[i]] = extra[names[i]];
        output.message = output.message || (changed ? changed + " keyframe" + (changed === 1 ? "" : "s") + " updated" : (skipped ? "No keyframes updated" : "Select keyframes to update."));
        if (skipped) output.message += " · " + skipped + " skipped";
        if (output.errors.length) output.message += " · " + output.errors[0];
        return output;
    }
    var host = {
        readSelection: readSelection,
        isBusy: function () { return active > 0; },
        lastSelection: function () { return lastSnapshot; },
        setColor: function (key, colorId) {
            // Read fresh data so colour never overwrites an easing/tangent edit.
            var data = readData(key.id); data.colorId = colorId;
            api.set(key.id, {data: data});
        },
        apply: function (expression, math) {
            math = mathModule(math);
            var validation = math.validate(expression);
            if (!validation.ok) return result(0, 0, [validation.error], {message: validation.error});
            return guarded(function () {
                var snapshot = readSelection(math, {samples: false}), changed = 0, errors = [];
                for (var i = 0; i < snapshot.keys.length; i++) {
                    var key = snapshot.keys[i];
                    try {
                        // Step interpolation bypasses Magic Easing in Cavalry 2.7.2.
                        // A direct data change preserves existing handle coordinates.
                        if (key.data.interpolation === 2) {
                            var smooth = readData(key.id); smooth.interpolation = 0;
                            api.set(key.id, {data: smooth});
                        }
                        api.magicEasing(key.layerId, key.attrId, key.frame, "Custom", validation.expression); host.setColor(key, PLUM); changed++;
                    }
                    catch (e) { restoreKey(key); errors.push(key.attrId + ": " + e.message); }
                }
                return result(changed, snapshot.keys.length - changed, errors, {expression: validation.expression});
            });
        },
        clear: function () {
            return guarded(function () {
                var snapshot = readSelection(null, {samples: false}), changed = 0, errors = [];
                for (var i = 0; i < snapshot.keys.length; i++) {
                    var key = snapshot.keys[i];
                    try { api.magicEasing(key.layerId, key.attrId, key.frame, NONE); host.setColor(key, SILVER); changed++; }
                    catch (e) { restoreKey(key); errors.push(key.attrId + ": " + e.message); }
                }
                return result(changed, snapshot.keys.length - changed, errors, {expression: "x"});
            });
        },
        flatten: function (math) {
            math = mathModule(math);
            return guarded(function () {
                var snapshot = readSelection(math, {samples: false}), changed = 0, errors = [], fits = [], changedIds = {};
                for (var i = 0; i < snapshot.segments.length; i++) {
                    var segment = snapshot.segments[i];
                    var rollback = null;
                    if (!segment.magic.active || changedIds[segment.a.id]) continue;
                    try {
                        if (!finite(segment.startValue) || !finite(segment.endValue)) throw new Error("Flatten requires a numeric channel.");
                        var fn;
                        if (segment.magic.expression) fn = math.compile(segment.magic.expression);
                        else {
                            var samples = sampleHost(segment, 129);
                            if (!samples || samples.length < 2) throw new Error("This Magic curve cannot be sampled.");
                            fn = interpolate(samples);
                        }
                        var fit = math.fitBezier(fn, {optimizeX: true});
                        if (fit.endpointMismatch > 0.0001) throw new Error("Curve endpoints must be 0 and 1 to flatten.");
                        rollback = segment.isMotionPath ? pathGeometry(segment) : [{id: segment.a.id, data: readData(segment.a.id)}, {id: segment.b.id, data: readData(segment.b.id)}];
                        if (segment.isMotionPath) {
                            var target = samplePositions(segment, 65);
                            var pathResult = flattenPosition(segment, fit, math, rollback, target);
                            for (var ps = 0; ps < pathResult.fits.length; ps++) {
                                var pathKey = pathResult.fits[ps].segment.a;
                                // A linked axis may be selected too; don't flatten its span twice.
                                if (snapshot.selectedIds.indexOf(pathKey.id) >= 0 && !changedIds[pathKey.id]) {
                                    host.setColor(pathKey, SILVER); changedIds[pathKey.id] = true; changed++;
                                }
                            }
                            fits.push({keyId: segment.a.id, curve: fit, motionPath: true, nativeError: pathResult.maxError});
                            continue;
                        }
                        api.magicEasing(segment.layerId, segment.attrId, segment.startFrame, NONE);
                        writeBezier(segment, fit, false);
                        host.setColor(segment.a, SILVER); changedIds[segment.a.id] = true; changed++;
                        fits.push({keyId: segment.a.id, curve: fit, motionPath: segment.isMotionPath});
                    } catch (e) {
                        if (rollback) for (var r = 0; r < rollback.length; r++) restoreKey(rollback[r]);
                        errors.push(segment.attrId + ": " + e.message);
                    }
                }
                // After a successful conversion, tag selected ordinary keys Silver too.
                // A failed active span stays intact; a terminal Magic flag can be cleared.
                for (var j = 0; j < snapshot.keys.length; j++) {
                    var key = snapshot.keys[j];
                    if (changedIds[key.id]) continue;
                    var hasSegment = snapshot.segments.some(function (s) { return s.a.id === key.id; });
                    // Leave a failed Magic span intact; color ordinary selected keys after success.
                    if ((hasSegment && key.magic.active) || (!key.magic.active && !changed)) continue;
                    try { if (key.magic.active) api.magicEasing(key.layerId, key.attrId, key.frame, NONE); host.setColor(key, SILVER); changedIds[key.id] = true; changed++; }
                    catch (e) { restoreKey(key); errors.push(key.attrId + ": " + e.message); }
                }
                var output = result(changed, snapshot.keys.length - changed, errors, {fits: fits});
                var maxError = 0;
                for (var k = 0; k < fits.length; k++) maxError = Math.max(maxError, fits[k].curve.maxError || 0, fits[k].nativeError || 0);
                output.maxError = maxError;
                if (fits.length) output.message += " · Bezier approximation " + (maxError * 100).toFixed(2) + "% max curve error";
                if (!changed && !errors.length) output.message = "Select keyframes with Magic Easing to flatten.";
                return output;
            });
        },
        sampleHost: sampleHost,
        math: mathModule(),
        colors: {magic: PLUM, clear: SILVER}
    };
    return host;
}());
if (typeof module !== "undefined" && module.exports) module.exports = MeaseyHost;

(function () {
 var report={passed:0,failed:0,tests:[],failures:[]},created=[];
 var savedFrame=api.getFrame(),savedKeys=api.getSelectedKeyframeIds(),savedLayers=api.getSelection();
 function near(a,b,t,m){if(typeof a!=='number'||Math.abs(a-b)>t)throw new Error(m+' ('+a+' vs '+b+')');}
 function assert(v,m){if(!v)throw new Error(m);}
 function test(n,fn){try{report.tests.push({name:n,ok:true,details:fn()});report.passed++;}catch(e){report.tests.push({name:n,ok:false,error:String(e)});report.failures.push(n+': '+String(e));report.failed++;}}
 function layer(name){var id=api.create('null','Measey Extended · '+name);created.push(id);return id;}
 function setData(id,edit){var d=api.get(id,'data');edit(d);api.set(id,{data:d});}
 function value(id,attr,fr){api.setFrame(fr);return api.get(id,attr);}
 try {
 test('Step and Linear keys accept normalized Magic',function(){var id=layer('interpolation'),a=api.keyframe(id,0,{'scale.x':0}),b=api.keyframe(id,24,{'scale.x':100}),details=[];api.setSelectedKeyframeIds([a]);for(var type=1;type<=2;type++){api.modifyKeyframe(id,{'scale.x':{frame:0,type:type}});var r=MeaseyHost.apply('pow(x,3)');var midpoint=value(id,'scale.x',12);details.push({type:type,midpoint:midpoint,result:r,data:api.get(a,'data')});near(midpoint,12.5,0.02,'Magic on interpolation '+type);}return details;});
 test('Flatten changes only facing handles and preserves adjacent animation',function(){var id=layer('neighbors'),frames=[0,24,48,72],vals=[0,25,100,110],ids=[];for(var k=0;k<4;k++)ids.push(api.keyframe(id,frames[k],{'scale.x':vals[k]}));for(var j=0;j<4;j++){setData(ids[j],function(d){d.interpolation=0;d.locked=true;d.weightLocked=true;d.leftBez={x:-8,y:-5};d.rightBez={x:8,y:5};});}setData(ids[2],function(d){d.rightBez={x:8,y:20};});api.setSelectedKeyframeIds([ids[1]]);MeaseyHost.apply('pow(x,3)');var beforeLeft=[],beforeRight=[];for(var fr=3;fr<24;fr+=3)beforeLeft.push(value(id,'scale.x',fr));for(var rr=51;rr<72;rr+=3)beforeRight.push(value(id,'scale.x',rr));var dataBeforeA=api.get(ids[1],'data'),dataBeforeB=api.get(ids[2],'data');var r=MeaseyHost.flatten(MeaseyMath);assert(r.changed===1,'Flatten should succeed: '+r.message);var afterA=api.get(ids[1],'data'),afterB=api.get(ids[2],'data');assert(afterA.locked===false && afterB.locked===false,'Facing keys must be explicitly unlocked');assert(afterA.weightLocked===false && afterB.weightLocked===false,'Weight locks must be cleared');assert(JSON.stringify(dataBeforeA.leftBez)===JSON.stringify(afterA.leftBez),'Previous incoming handle must stay unchanged');assert(JSON.stringify(dataBeforeB.rightBez)===JSON.stringify(afterB.rightBez),'Next outgoing handle must stay unchanged');for(var fl=3,index=0;fl<24;fl+=3,index++)near(value(id,'scale.x',fl),beforeLeft[index],0.01,'Previous interval at'+fl);for(var nx=51,ind=0;nx<72;nx+=3,ind++)near(value(id,'scale.x',nx),beforeRight[ind],0.01,'Following interval at'+nx);near(value(id,'scale.x',36),34.375,0.02,'Cubic interval midpoint');return {result:r,beforeA:dataBeforeA,afterA:afterA,beforeB:dataBeforeB,afterB:afterB};});
 test('Straight paired position preserves rendered Magic timing',function(){var id=layer('straight path'),ax=api.keyframe(id,0,{'position.x':0}),ay=api.keyframe(id,0,{'position.y':0}),bx=api.keyframe(id,60,{'position.x':300}),by=api.keyframe(id,60,{'position.y':0});api.setSelectedKeyframeIds([ax,ay]);MeaseyHost.apply('pow(x,3)');var beforeA=api.get(ax,'data'),beforeB=api.get(bx,'data'),expected=[],actual=[];for(var fr=0;fr<=60;fr+=5)expected.push({x:value(id,'position.x',fr),y:api.get(id,'position.y')});var r=MeaseyHost.flatten(MeaseyMath);assert(r.changed===2,'Both position channels should flatten: '+r.message);var maxErr=0;for(var f=0,i=0;f<=60;f+=5,i++){var x=value(id,'position.x',f),y=api.get(id,'position.y');actual.push({x:x,y:y});near(y,0,0.01,'Straight path y');maxErr=Math.max(maxErr,Math.abs(x-expected[i].x)/300);}var afterA=api.get(ax,'data'),afterB=api.get(bx,'data');report.straight={result:r,maxNativeError:maxErr,expected:expected,actual:actual,beforeA:beforeA,afterA:afterA,beforeB:beforeB,afterB:afterB};assert(maxErr<0.02,'Native path timing error must stay below2%, found'+(100*maxErr)+'%');return {result:r,maxNativeError:maxErr,expected:expected,actual:actual,beforeA:beforeA,afterA:afterA};});
 test('Magic on a curved paired position flattens its rendered trajectory',function(){var id=layer('curved path'),ax=api.keyframe(id,0,{'position.x':0}),ay=api.keyframe(id,0,{'position.y':0}),bx=api.keyframe(id,60,{'position.x':300}),by=api.keyframe(id,60,{'position.y':0});setData(ax,function(d){d.interpolation=0;d.rightBez={x:20,y:30};d.locked=false;d.weightLocked=false;});setData(ay,function(d){d.interpolation=0;d.rightBez={x:20,y:250};d.locked=false;d.weightLocked=false;});setData(bx,function(d){d.interpolation=0;d.leftBez={x:-20,y:-30};d.locked=false;d.weightLocked=false;});setData(by,function(d){d.interpolation=0;d.leftBez={x:-20,y:250};d.locked=false;d.weightLocked=false;});api.setSelectedKeyframeIds([ax,ay]);MeaseyHost.apply('pow(x,3)');var before=[],dataBefore=[api.get(ax,'data'),api.get(ay,'data'),api.get(bx,'data'),api.get(by,'data')];for(var fr=0;fr<=60;fr+=5)before.push({x:value(id,'position.x',fr),y:api.get(id,'position.y')});var r=MeaseyHost.flatten(MeaseyMath),after=[],maxErr=0;assert(r.changed===2,'Curved channels should flatten: '+r.message);for(var f=0,i=0;f<=60;f+=5,i++){var x=value(id,'position.x',f),y=api.get(id,'position.y');after.push({x:x,y:y});maxErr=Math.max(maxErr,Math.sqrt(Math.pow(x-before[i].x,2)+Math.pow(y-before[i].y,2))/300);}var dataAfter=[api.get(ax,'data'),api.get(ay,'data'),api.get(bx,'data'),api.get(by,'data')];report.curved={result:r,maxNativeError:maxErr,before:before,after:after,dataBefore:dataBefore,dataAfter:dataAfter};assert(maxErr<0.03,'Curved trajectory error should stay below3% of chord, found'+maxErr*100+'%');return {result:r,maxNativeError:maxErr,before:before,after:after};});

 test('One selected Magic position axis preserves its rendered pair and neighbors',function(){
 var id=layer('single axis path'),frames=[0,30,90,120],x=[-40,0,300,340],y=[-10,0,0,30],kx=[],ky=[];
 for(var i=0;i<frames.length;i++){kx.push(api.keyframe(id,frames[i],{'position.x':x[i]}));ky.push(api.keyframe(id,frames[i],{'position.y':y[i]}));}
 for(var j=0;j<frames.length;j++){setData(kx[j],function(d){d.interpolation=0;d.leftBez={x:-10,y:-15};d.rightBez={x:10,y:15};d.locked=true;d.weightLocked=true;});setData(ky[j],function(d){d.interpolation=0;d.leftBez={x:-10,y:-20};d.rightBez={x:10,y:20};d.locked=true;d.weightLocked=true;});}
 setData(kx[1],function(d){d.rightBez={x:20,y:30};});setData(ky[1],function(d){d.rightBez={x:20,y:200};});setData(kx[2],function(d){d.leftBez={x:-20,y:-30};});setData(ky[2],function(d){d.leftBez={x:-20,y:200};});
 for(var a=0;a<2;a++){var attr=a===0?'position.x':'position.y',left={frame:30,leftSpeed:.6,leftInfluence:.23},right={frame:90,rightSpeed:1.7,rightInfluence:.41},dl={},dr={};dl[attr]=left;dr[attr]=right;api.setKeyframeVelocity(id,dl);api.setKeyframeVelocity(id,dr);}
 api.setSelectedKeyframeIds([kx[1]]);MeaseyHost.apply('pow(x,3)');
 var before=[],previous=[],following=[],dataBefore=[api.get(kx[1],'data'),api.get(ky[1],'data'),api.get(kx[2],'data'),api.get(ky[2],'data')];
 for(var fr=30;fr<=90;fr+=5)before.push({x:value(id,'position.x',fr),y:api.get(id,'position.y')});
 for(var l=5;l<30;l+=5)previous.push({x:value(id,'position.x',l),y:api.get(id,'position.y')});for(var n=95;n<120;n+=5)following.push({x:value(id,'position.x',n),y:api.get(id,'position.y')});
 api.setFrame(17);var r=MeaseyHost.flatten(MeaseyMath);assert(api.getFrame()===17,'Flatten sampling must restore frame');
 var after=[],maxError=0,dataAfter=[api.get(kx[1],'data'),api.get(ky[1],'data'),api.get(kx[2],'data'),api.get(ky[2],'data')];
 for(var f=30,k=0;f<=90;f+=5,k++){var point={x:value(id,'position.x',f),y:api.get(id,'position.y')};after.push(point);maxError=Math.max(maxError,Math.sqrt(Math.pow(point.x-before[k].x,2)+Math.pow(point.y-before[k].y,2))/300);}
 report.singleAxis={result:r,before:before,after:after,maxNativeError:maxError,dataBefore:dataBefore,dataAfter:dataAfter};
 assert(r.changed===1,'One selected key should report one change: '+r.message);assert(maxError<0.03,'One-axis paired error exceeds3%: '+(maxError*100));
 for(var p=0;p<4;p++){var side=p<2?'leftBez':'rightBez';assert(JSON.stringify(dataBefore[p][side])===JSON.stringify(dataAfter[p][side]),'Opposite handle '+p+' must survive');var speed=p<2?'leftSpeed':'rightSpeed',influence=p<2?'leftInfluence':'rightInfluence';near(dataAfter[p][speed],dataBefore[p][speed],1e-8,'Outer speed '+p);near(dataAfter[p][influence],dataBefore[p][influence],1e-8,'Outer influence '+p);}
 for(var ll=5,ix=0;ll<30;ll+=5,ix++){near(value(id,'position.x',ll),previous[ix].x,.03,'Previous x');near(api.get(id,'position.y'),previous[ix].y,.03,'Previous y');}
 for(var nn=95,iy=0;nn<120;nn+=5,iy++){near(value(id,'position.x',nn),following[iy].x,.03,'Following x');near(api.get(id,'position.y'),following[iy].y,.03,'Following y');}
 return report.singleAxis;
 });

 test('Flatten preserves Linear and Magic neighbors and safely skips Step',function(){
 var details=[];
 for(var mode=0;mode<3;mode++){
 var id=layer('following interpolation '+mode),a=api.keyframe(id,0,{'scale.x':0}),b=api.keyframe(id,24,{'scale.x':100}),c=api.keyframe(id,48,{'scale.x':175});
 if(mode<2)api.modifyKeyframe(id,{'scale.x':{frame:24,type:mode+1}});else api.magicEasing(id,'scale.x',24,'Custom','pow(x,2)');
 api.setSelectedKeyframeIds([a]);MeaseyHost.apply('pow(x,3)');var previous=[];for(var fr=27;fr<48;fr+=3)previous.push(value(id,'scale.x',fr));var endBefore=api.get(b,'data'),r=MeaseyHost.flatten(MeaseyMath),endAfter=api.get(b,'data');
 if(mode===1){assert(r.changed===0 && r.errors.length>0,'Following Step should be skipped safely');assert(api.get(a,'data').easing===34,'Skipped Magic flag must remain');assert(JSON.stringify(endAfter)===JSON.stringify(endBefore),'Step endpoint data must remain');}
 else{assert(r.changed===1,'Flatten start should succeed in mode'+mode+': '+r.message);assert(endAfter.interpolation===0,'Fitted incoming key must be Bezier');}
 near(value(id,'scale.x',12),12.5,.02,'Flatten cubic or preserved Magic at midpoint');
 assert(endAfter.easing===endBefore.easing,'End Magic flag must survive mode'+mode);assert(endAfter.exprEasing===endBefore.exprEasing,'End Magic expression must survive mode'+mode);
 for(var f=27,i=0;f<48;f+=3,i++)near(value(id,'scale.x',f),previous[i],.02,'Following mode'+mode+' at'+f);
 details.push({mode:mode,result:r,endBefore:endBefore,endAfter:endAfter});
 }
 var extra=layer('implicit linear sides'),ka=api.keyframe(extra,0,{'scale.x':-50}),kb=api.keyframe(extra,24,{'scale.x':0}),kc=api.keyframe(extra,48,{'scale.x':100}),kd=api.keyframe(extra,72,{'scale.x':170});
 setData(ka,function(d){d.interpolation=0;d.rightBez={x:8,y:3};d.locked=false;d.weightLocked=false;});setData(kd,function(d){d.interpolation=0;d.leftBez={x:-8,y:-4};d.locked=false;d.weightLocked=false;});
 api.setSelectedKeyframeIds([kb]);MeaseyHost.apply('pow(x,3)');var left=[],right=[];
 for(var lf=3;lf<24;lf+=3)left.push(value(extra,'scale.x',lf));for(var rf=51;rf<72;rf+=3)right.push(value(extra,'scale.x',rf));
 var rr=MeaseyHost.flatten(MeaseyMath);assert(rr.changed===1,'Implicit linear sides should flatten: '+rr.message);
 for(var l=3,li=0;l<24;l+=3,li++)near(value(extra,'scale.x',l),left[li],.02,'Implicit incoming Linear tangent');for(var rt=51,ri=0;rt<72;rt+=3,ri++)near(value(extra,'scale.x',rt),right[ri],.02,'Implicit outgoing Linear tangent');
 details.push({implicitLinearSides:rr});return details;
 });
 }catch(e){report.failures.push('Setup: '+String(e));report.failed++;}
 finally{for(var i=0;i<created.length;i++)try{api.deleteLayer(created[i]);}catch(e){}try{api.select(savedLayers);api.setSelectedKeyframeIds(savedKeys);api.setFrame(savedFrame);}catch(e){}report.finished=true;api.writeToFile('/tmp/measey-native-extended.json',JSON.stringify(report,null,2),true);console.log('Measey extended: '+report.passed+' passed, '+report.failed+' failed.');}
}());
