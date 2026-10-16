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
    function powerExpression(power, type, midpoint, bottom, top) {
        if (!finite(power) || power < 1) throw new Error("Power must be a finite number of at least 1.");
        type = type === undefined ? "in" : String(type).toLowerCase().trim().replace(/\s+/g, " ");
        if (type !== "in" && type !== "out" && type !== "in out") throw new Error("Choose power easing type: in, out or in out.");
        if (type === "in out") {
            midpoint = midpoint === undefined ? 0.5 : midpoint;
            if (!finite(midpoint) || midpoint < 0.01 || midpoint > 0.99) throw new Error("Both midpoint must be a finite number from 0.01 to 0.99.");
        }
        bottom = bottom === undefined ? 0 : bottom;
        top = top === undefined ? 0 : top;
        if (!finite(bottom) || bottom < 0 || bottom > 1 || !finite(top) || top < 0 || top > 1) throw new Error("Endpoint slopes must be finite numbers from 0 to 1.");
        if (power === 1) return "x";
        var n = String(power);
        if (type === "in" && bottom !== 0) return "var power := " + n + "; var bottom := " + String(bottom) + "; bottom * x + (1 - bottom) * pow(x, power)";
        if (type === "out" && top !== 0) return "var power := " + n + "; var top := " + String(top) + "; 1 - (top * (1 - x) + (1 - top) * pow(1 - x, power))";
        if (type === "in out" && (bottom !== 0 || top !== 0)) {
            // Each normalized branch has endpoint slope e and common join J.
            // f(u)=e*u+(1-e)*u^p+c*u^p*(1-u), c=(p-1)*(M-e).
            // J=1+(p-1)*(1-M) avoids losing the residual 1 at large p.
            // Its derivative is e+u^(p-1)[p(1-e+c)-c(p+1)u]. The bracket
            // decreases to J-e>=0, so both branches remain monotone. Unlike an
            // exponent substitution, e=1 does not erase the opposite control.
            var prefix = "var power := " + n + "; var bottom := " + String(bottom) + "; var top := " + String(top) + "; var midpoint := " + String(midpoint) + "; var maximum := max(bottom, top); var join := 1 + (power - 1) * (1 - maximum); ";
            function branch(input, endpoint) {
                return endpoint + " * (" + input + ") + (1 - " + endpoint + ") * pow(" + input + ", power) + (power - 1) * (maximum - " + endpoint + ") * pow(" + input + ", power) * (1 - (" + input + "))";
            }
            return prefix + "x < midpoint ? midpoint * (" + branch("x / midpoint", "bottom") + ") : 1 - (1 - midpoint) * (" + branch("(1 - x) / (1 - midpoint)", "top") + ")";
        }
        if (type === "in") return "pow(x, " + n + ")";
        if (type === "out") return "1 - pow(1 - x, " + n + ")";
        if (midpoint !== 0.5) {
            var split = String(midpoint);
            return "x < " + split + " ? " + split + " * pow(x / " + split + ", " + n + ") : 1 - (1 - " + split + ") * pow((1 - x) / (1 - " + split + "), " + n + ")";
        }
        return "x < 0.5 ? pow(2 * x, " + n + ") / 2 : 1 - pow(2 * (1 - x), " + n + ") / 2";
    }
    function detectPower(expression) {
        // Recognition is limited to expression strings. In particular, a fitted
        // Bezier or a host's sampled curve is not evidence of a Power expression.
        if (typeof expression !== "string" || !expression.trim()) return null;
        try {
            var fn = compile(expression), probes = [0, 1, 0.0157, 0.0371, 0.0813, 0.1297,
                0.1741, 0.2339, 0.2917, 0.3593, 0.4171, 0.5, 0.5639, 0.6293,
                0.6831, 0.7499, 0.8173, 0.8731, 0.9317, 0.9739];
            // Irregular locations defeat the trigonometric aliases possible on
            // a regular grid. Sample once, then compare each candidate family.
            for (var i = 1; i <= 64; i++) probes.push((i * 0.6180339887498949) % 1);
            var values = [];
            for (var j = 0; j < probes.length; j++) values.push(fn(probes[j]));
            if (Math.abs(values[0]) > 1e-9 || Math.abs(values[1] - 1) > 1e-9) return null;
            // Keep the bases away from zero and one to avoid underflow and
            // cancellation while recovering ordinary exponents. Larger source
            // constants are also tried directly below, avoiding pow underflow.
            var base = 0.763, denominator = Math.log(base);
            var candidates = [
                {direction: "in", power: Math.log(fn(base)) / denominator},
                {direction: "out", power: Math.log(1 - fn(1 - base)) / denominator}
            ];
            function recognize(candidate) {
                if (!finite(candidate.power)) return null;
                var power = candidate.explicit ? candidate.power : Number(candidate.power.toPrecision(12));
                if (power < 1) return null;
                var bottom = candidate.bottom === undefined ? 0 : candidate.bottom;
                var top = candidate.top === undefined ? 0 : candidate.top;
                if (!finite(bottom) || bottom < 0 || bottom > 1 || !finite(top) || top < 0 || top > 1) return null;
                if (candidate.direction === "in out" && (!finite(candidate.midpoint) || candidate.midpoint < 0.01 || candidate.midpoint > 0.99)) return null;
                var expected = compile(powerExpression(power, candidate.direction, candidate.midpoint, bottom, top));
                for (var p = 0; p < probes.length; p++) {
                    var reference = expected(probes[p]);
                    if (Math.abs(values[p] - reference) > 1e-9 * Math.max(1, Math.abs(values[p]), Math.abs(reference))) {
                        return null;
                    }
                }
                if (power > 12) {
                    // General probes can all underflow at high powers. Check
                    // where u^power is appreciable, retaining source precision
                    // and rejecting a different exponent or a disguised Step.
                    var decay = [0.131, 0.763, 1.931, 4.373, 11.017];
                    for (var transition = 0; transition < decay.length; transition++) {
                        var u = Math.exp(-decay[transition] / power);
                        var positions = candidate.direction === "in out" ? [candidate.midpoint * u, 1 - (1 - candidate.midpoint) * u] :
                            (candidate.direction === "out" ? [1 - u] : [u]);
                        for (var position = 0; position < positions.length; position++) {
                            if (Math.abs(fn(positions[position]) - expected(positions[position])) > 1e-9) return null;
                        }
                    }
                }
                if (candidate.direction === "in out") {
                    // Check both short branches close to their split as well:
                    // a midpoint near an endpoint must not evade the probes.
                    var fractions = [0.017, 0.131, 0.373, 0.763, 0.931, 1];
                    for (var q = 0; q < fractions.length; q++) {
                        var left = candidate.midpoint * fractions[q];
                        var right = 1 - (1 - candidate.midpoint) * fractions[q];
                        if (Math.abs(fn(left) - expected(left)) > 1e-9 || Math.abs(fn(right) - expected(right)) > 1e-9) return null;
                    }
                }
                if (power === 1) return {power: 1, direction: "in"};
                var result = {power: power, direction: candidate.direction};
                if (candidate.direction === "in out") result.midpoint = candidate.midpoint;
                if (bottom !== 0 && candidate.direction !== "out") result.bottom = bottom;
                if (top !== 0 && candidate.direction !== "in") result.top = top;
                return result;
            }
            // Read constant declarations with the same bounded AST evaluator.
            // They are candidate hints only: every returned curve must match
            // the complete expression at all probes and on both short branches.
            var program = new Parser(tokenize(expression)).program(), constantVars = {};
            function constant(node) {
                if (node.type === "number") return true;
                if (node.type === "input") return false;
                if (node.type === "variable") return own(constantVars, node.name);
                if (node.type === "unary") return constant(node.arg);
                if (node.type === "condition") return constant(node.test) && constant(node.yes) && constant(node.no);
                if (node.type === "call") return node.args.every(constant);
                return constant(node.left) && constant(node.right);
            }
            function constantValue(node) { return constant(node) ? evaluate(node, 0, constantVars, {count: 20000}) : NaN; }
            for (var d = 0; d < program.declarations.length; d++) {
                var declaration = program.declarations[d], declaredValue = constantValue(declaration.value);
                if (finite(declaredValue)) constantVars[declaration.name] = declaredValue;
            }
            // Include source-derived short branches before recognizing any
            // family. Otherwise a linear opposite branch could make a narrow
            // Both alias look like x on all the general-purpose probes.
            var exponents = [], midpoints = [], splitPoints = [];
            function add(list, value, lower, upper, limit) {
                if (!finite(value) || value < lower || value > upper || list.length >= limit) return;
                if (list.indexOf(value) < 0) list.push(value);
            }
            function addSplit(value) {
                add(midpoints, value, 0.01, 0.99, 8);
                add(splitPoints, value, 0, 1, 16);
            }
            function hints(node) {
                if (node.type === "call") {
                    if (node.name === "pow") add(exponents, constantValue(node.args[1]), 1, Infinity, 24);
                    node.args.forEach(hints);
                } else if (node.type === "binary") {
                    if (node.op === "^") add(exponents, constantValue(node.right), 1, Infinity, 24);
                    if (["<", "<=", ">", ">="].indexOf(node.op) >= 0) {
                        if (node.left.type === "input") addSplit(constantValue(node.right));
                        if (node.right.type === "input") addSplit(constantValue(node.left));
                    }
                    hints(node.left);hints(node.right);
                } else if (node.type === "condition") { hints(node.test);hints(node.yes);hints(node.no); }
                else if (node.type === "unary") hints(node.arg);
            }
            for (var dh = 0; dh < program.declarations.length; dh++) hints(program.declarations[dh].value);
            hints(program.result);
            // Expanded polynomial aliases, such as .3*x+.7*x*x*x, carry no
            // pow exponent. Derive their degree from the bounded AST instead of
            // searching a fixed integer range that would act as a second cap.
            var polynomialVars = {};
            function polynomialDegree(node) {
                if (node.type === "number") return 0;
                if (node.type === "input") return 1;
                if (node.type === "variable") return own(constantVars, node.name) ? 0 : (own(polynomialVars, node.name) ? polynomialVars[node.name] : NaN);
                if (node.type === "unary" && (node.op === "+" || node.op === "-")) return polynomialDegree(node.arg);
                if (node.type === "call") return constant(node) ? 0 : NaN;
                if (node.type === "condition") return Math.max(polynomialDegree(node.yes), polynomialDegree(node.no));
                if (node.type !== "binary") return NaN;
                var leftDegree = polynomialDegree(node.left), rightDegree = polynomialDegree(node.right);
                if (!finite(leftDegree) || !finite(rightDegree)) return NaN;
                if (node.op === "+" || node.op === "-") return Math.max(leftDegree, rightDegree);
                if (node.op === "*") return leftDegree + rightDegree;
                if (node.op === "/" && rightDegree === 0) return leftDegree;
                if (node.op === "^") {
                    var exponentValue = constantValue(node.right);
                    if (finite(exponentValue) && exponentValue >= 0 && Math.floor(exponentValue) === exponentValue) return leftDegree * exponentValue;
                }
                return NaN;
            }
            for (var pd = 0; pd < program.declarations.length; pd++) polynomialVars[program.declarations[pd].name] = polynomialDegree(program.declarations[pd].value);
            var degree = polynomialDegree(program.result);
            add(exponents, degree, 1, Infinity, 24);
            if (midpoints.length && finite(degree) && Math.floor(degree) === degree) add(exponents, degree - 1, 1, Infinity, 24);
            var branchFractions = [0.017, 0.131, 0.373, 0.763, 0.931, 1];
            for (var sp = 0; sp < splitPoints.length; sp++) for (var bf = 0; bf < branchFractions.length; bf++) {
                var leftProbe = splitPoints[sp] * branchFractions[bf];
                var rightProbe = 1 - (1 - splitPoints[sp]) * branchFractions[bf];
                probes.push(leftProbe, rightProbe);values.push(fn(leftProbe), fn(rightProbe));
            }
            if (own(constantVars, "power") && (own(constantVars, "bottom") || own(constantVars, "top"))) {
                var hinted = {power: constantVars.power, bottom: own(constantVars, "bottom") ? constantVars.bottom : 0, top: own(constantVars, "top") ? constantVars.top : 0, explicit: true};
                var hintedDirections = own(constantVars, "midpoint") ? ["in out", "in", "out"] : ["in", "out"];
                for (var hd = 0; hd < hintedDirections.length; hd++) {
                    hinted.direction = hintedDirections[hd];hinted.midpoint = constantVars.midpoint;
                    var fromHints = recognize(hinted);
                    if (fromHints) return fromHints;
                }
            }
            // Above the slider's soft limit, preserve exact source constants
            // before logarithmic inference can round or underflow them.
            for (var sourceExponent = 0; sourceExponent < exponents.length; sourceExponent++) {
                if (exponents[sourceExponent] <= 12) continue;
                var sourceDirections = ["in", "out"];
                for (var sd = 0; sd < sourceDirections.length; sd++) {
                    var fromSource = recognize({power: exponents[sourceExponent], direction: sourceDirections[sd], explicit: true});
                    if (fromSource) return fromSource;
                }
                for (var sourceMidpoint = 0; sourceMidpoint < midpoints.length; sourceMidpoint++) {
                    var sourceBoth = recognize({power: exponents[sourceExponent], direction: "in out", midpoint: midpoints[sourceMidpoint], explicit: true});
                    if (sourceBoth) return sourceBoth;
                }
            }
            for (var k = 0; k < candidates.length; k++) {
                var detected = recognize(candidates[k]);
                if (detected) return detected;
            }
            // Both curves cross the identity only at their interior split:
            // f(x)<x to its left, f(x)>x to its right. Recover that split by
            // bisection, then recover the exponent from a normalized branch.
            // This recognizes algebraic aliases without trusting source text.
            var lo = 0.0000001, hi = 0.9999999, numericalMidpoint = null;
            if (fn(lo) < lo && fn(hi) > hi) {
                for (var iteration = 0; iteration < 60; iteration++) {
                    var center = (lo + hi) / 2, offset = fn(center) - center;
                    if (offset === 0) { lo = hi = center; break; }
                    if (offset < 0) lo = center; else hi = center;
                }
                numericalMidpoint = Number(((lo + hi) / 2).toPrecision(12));
                if (numericalMidpoint >= 0.01 && numericalMidpoint <= 0.99) {
                    var legacyBoth = recognize({direction: "in out", midpoint: numericalMidpoint,
                        power: Math.log(fn(numericalMidpoint * base) / numericalMidpoint) / denominator});
                    if (legacyBoth) return legacyBoth;
                }
            }
            // Inline aliases may omit declarations. Collect bounded constant
            // exponent/split hints, solve their linear endpoint coefficients,
            // then subject each inferred candidate to the same full validation.
            add(midpoints, numericalMidpoint, 0.01, 0.99, 8);
            function endpoint(value) {
                if (!finite(value) || value < -1e-10 || value > 1 + 1e-10) return NaN;
                if (Math.abs(value) < 1e-12) return 0;
                if (Math.abs(value - 1) < 1e-12) return 1;
                return Number(clamp(value, 0, 1).toPrecision(12));
            }
            for (var ep = 0; ep < exponents.length; ep++) {
                var exponent = exponents[ep], poweredBase = Math.pow(base, exponent), span = base - poweredBase;
                if (exponent <= 1) continue;
                var inferredBottom = endpoint((fn(base) - poweredBase) / span);
                var inferredTop = endpoint((1 - fn(1 - base) - poweredBase) / span);
                var blendIn = recognize({direction: "in", power: exponent, bottom: inferredBottom, explicit: exponent > 12});
                if (blendIn) return blendIn;
                var blendOut = recognize({direction: "out", power: exponent, top: inferredTop, explicit: exponent > 12});
                if (blendOut) return blendOut;
                for (var mp = 0; mp < midpoints.length; mp++) {
                    var midpoint = midpoints[mp], leftValue = fn(midpoint * base) / midpoint, rightValue = (1 - fn(1 - (1 - midpoint) * base)) / (1 - midpoint);
                    var correction = (exponent - 1) * poweredBase * (1 - base), endpointSpan = span - correction;
                    var maximum = Math.max(leftValue, rightValue), commonEndpoint = (maximum - poweredBase) / span;
                    var bottom = endpoint((leftValue - poweredBase - commonEndpoint * correction) / endpointSpan);
                    var top = endpoint((rightValue - poweredBase - commonEndpoint * correction) / endpointSpan);
                    var blendBoth = recognize({direction: "in out", power: exponent, midpoint: midpoint, bottom: bottom, top: top, explicit: exponent > 12});
                    if (blendBoth) return blendBoth;
                }
            }
        } catch (error) {}
        return null;
    }
    function defaults() {
        return [];
    }
    return {compile: compile, validate: validate, sample: sample, bezierValue: bezierValue, fitBezier: fitBezier, powerExpression: powerExpression, detectPower: detectPower, defaults: defaults, finite: finite};
}());
if (typeof module !== "undefined" && module.exports) module.exports = MeaseyMath;

/* Measey — original Cavalry keyframe adapter, 2026.
 * Target: Cavalry 2.7.2 and later; editor/UI api only.
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
    function selectionReader() {
        // These caches live for one read only: edits always fetch fresh key data.
        var attributes = Object.create(null), keys = Object.create(null), layers = Object.create(null);
        function attribute(layer, attr) {
            var path = layer + "." + attr;
            if (!attributes[path]) {
                var times = api.getKeyframeTimes(layer, attr) || [];
                var ids = api.getKeyframeIdsForAttribute(layer, attr) || [];
                var frameIds = Object.create(null), nextFrames = Object.create(null);
                for (var i = 0; i < times.length; i++) if (ids[i]) frameIds[times[i]] = ids[i];
                var sorted = times.slice().sort(function (a, b) { return a - b; });
                for (var j = 0; j + 1 < sorted.length; j++) nextFrames[sorted[j]] = sorted[j + 1];
                attributes[path] = {frameIds: frameIds, nextFrames: nextFrames};
            }
            return attributes[path];
        }
        return {
            attribute: attribute,
            key: function (id, layer, attr, frame) {
                if (!keys[id]) keys[id] = keyAt(id, layer, attr, frame);
                return keys[id];
            },
            layerExists: function (id) {
                if (layers[id] === undefined) layers[id] = typeof api.layerExists !== "function" || api.layerExists(id);
                return layers[id];
            }
        };
    }
    function pairedPosition(segment, reader) {
        if (segment.attrId !== "position.x" && segment.attrId !== "position.y") return false;
        var sibling = segment.attrId === "position.x" ? "position.y" : "position.x";
        try {
            if (reader) {
                var attribute = reader.attribute(segment.layerId, sibling);
                return !!attribute.frameIds[segment.startFrame] && !!attribute.frameIds[segment.endFrame];
            }
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
    function previewReader(math) {
        var samples = Object.create(null), expressions = Object.create(null);
        return {
            sample: function (signature, fn) {
                if (!samples[signature]) {
                    try { samples[signature] = {samples: math.sample(fn, 129)}; }
                    catch (e) { samples[signature] = {error: e.message}; }
                }
                return samples[signature];
            },
            expressionError: function (expression) {
                if (!expressions[expression]) {
                    try { math.compile(expression); expressions[expression] = {ok: true}; }
                    catch (e) { expressions[expression] = {error: e.message}; }
                }
                return expressions[expression].error;
            }
        };
    }
    function segmentCurve(segment, math, includeSamples, previews) {
        var expression = segment.magic.expression;
        var result = {keyId: segment.a.id, expression: expression, magic: segment.magic.active,
            layerId: segment.layerId, attrId: segment.attrId, startFrame: segment.startFrame, endFrame: segment.endFrame, samples: null};
        if (expression) {
            if (!math) return result;
            if (includeSamples) {
                var sampled = previews.sample("expression:" + expression, expression);
                result.samples = sampled.samples || null; result.error = sampled.error;
            } else {
                // Descriptor previews avoid sampling here, but unsupported ExprTk
                // expressions retain the native fallback used by the full preview.
                result.error = previews.expressionError(expression);
            }
            if (!result.error) return result;
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
                if (includeSamples && math) {
                    var controls = result.bezier;
                    var sampledBezier = previews.sample("bezier:" + [controls.x1, controls.y1, controls.x2, controls.y2].join(","),
                        function (x) { return math.bezierValue(x, controls); });
                    result.samples = sampledBezier.samples || null; result.error = sampledBezier.error;
                }
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
            var idLookup = Object.create(null), keys = [], segments = [], errors = [], groups = [];
            var reader = selectionReader(), previews = previewReader(math);
            for (var id = 0; id < selectedIds.length; id++) idLookup[selectedIds[id]] = true;
            var paths = Object.keys(selection);
            for (var p = 0; p < paths.length; p++) {
                var parsed = parsePath(paths[p]);
                if (!parsed) { errors.push("An invalid attribute path was skipped."); continue; }
                try {
                    if (!reader.layerExists(parsed.layerId)) continue;
                    var attribute = reader.attribute(parsed.layerId, parsed.attrId);
                    var frameIds = attribute.frameIds;
                    var frames = selection[paths[p]].slice().sort(function (a, b) { return a - b; });
                    var group = {layerId: parsed.layerId, attrId: parsed.attrId, frames: frames, keys: []};
                    for (var f = 0; f < frames.length; f++) {
                        var frame = frames[f], keyId = frameIds[frame];
                        if (!keyId || (selectedIds.length && !idLookup[keyId])) continue;
                        var key = reader.key(keyId, parsed.layerId, parsed.attrId, frame);
                        keys.push(key); group.keys.push(key);
                        var nextFrame = attribute.nextFrames[frame], nextId = frameIds[nextFrame];
                        if (!nextId) continue;
                        var next = reader.key(nextId, parsed.layerId, parsed.attrId, nextFrame);
                        var segment = {a: key, b: next, layerId: parsed.layerId, attrId: parsed.attrId,
                            startFrame: frame, endFrame: nextFrame, startValue: key.value, endValue: next.value,
                            duration: nextFrame - frame, magic: key.magic};
                        segment.isMotionPath = pairedPosition(segment, reader);
                        segments.push(segment);
                    }
                    groups.push(group);
                } catch (e) { errors.push(parsed.attrId + ": " + e.message); }
            }
            var expressions = [], magicNames = [], expressionLookup = Object.create(null), magicLookup = Object.create(null);
            // The terminal key has no outgoing interval. Its stored flag should
            // not make an otherwise uniform selected interval look mixed.
            var representativeKeys = segments.length ? segments.map(function (s) { return s.a; }) : keys;
            for (var ki = 0; ki < representativeKeys.length; ki++) {
                var representative = representativeKeys[ki];
                var expr = representative.magic.expression || (representative.magic.active ? "" : "x");
                if (!expressionLookup[expr]) { expressionLookup[expr] = true; expressions.push(expr); }
                if (!magicLookup[representative.magic.name]) { magicLookup[representative.magic.name] = true; magicNames.push(representative.magic.name); }
            }
            var curves = [];
            var limitedPreview = finite(options.previewLimit);
            var previewKeyCount = limitedPreview ? Math.min(keys.length, Math.max(0, Math.floor(options.previewLimit))) : keys.length;
            if (options.preview !== false) {
                var previewSegments = Object.create(null);
                for (var si = 0; si < segments.length; si++) previewSegments[segments[si].a.id] = segments[si];
                // Budget selected keys before constructing or sampling a curve.
                // A terminal key consumes its slot; later keys never fill it.
                for (var pi = 0; pi < previewKeyCount; pi++) {
                    var previewKey = keys[pi], previewSegment = previewSegments[previewKey.id];
                    if (previewSegment) curves.push(segmentCurve(previewSegment, math, options.samples !== false, previews));
                    else if ((limitedPreview || !segments.length) && previewKey.magic.expression) {
                        var terminalCurve = {keyId: previewKey.id, expression: previewKey.magic.expression, magic: true,
                            layerId: previewKey.layerId, attrId: previewKey.attrId, startFrame: previewKey.frame, samples: null};
                        if (math && options.samples !== false) {
                            var terminalSample = previews.sample("expression:" + terminalCurve.expression, terminalCurve.expression);
                            terminalCurve.samples = terminalSample.samples || null; terminalCurve.error = terminalSample.error;
                        }
                        curves.push(terminalCurve);
                    }
                }
            }
            var snapshot = {keys: keys, segments: segments, groups: groups, count: keys.length,
                selectedIds: keys.map(function (k) { return k.id; }), expression: expressions.length === 1 ? expressions[0] : "",
                curveExpression: segments.length ? segments[0].magic.expression : (expressions[0] || "x"),
                mixed: expressions.length > 1 || magicNames.length > 1, previewCurves: curves, curves: curves,
                errors: errors, activeComp: api.getActiveComp(),
                message: keys.length ? keys.length + " keyframe" + (keys.length === 1 ? "" : "s") + " selected" + (segments.length ? " · " + segments.length + " outgoing curve" + (segments.length === 1 ? "" : "s") : " · final keyframe") : "Select keyframes to preview their curves."};
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
    function flushUpdates(changed, errors) {
        // One batch flush keeps GUI updates current without pumping events per key.
        if (changed && typeof api.processEvents === "function") {
            try { api.processEvents(); }
            catch (e) { errors.push("GUI update: " + e.message); }
        }
    }
    var host = {
        readSelection: readSelection,
        isBusy: function () { return active > 0; },
        lastSelection: function () { return lastSnapshot; },
        setColor: function (key, colorId) {
            // Read fresh data so colour never overwrites an easing/tangent edit.
            var data = readData(key.id); data.colorId = colorId;
            api.set(key.id, {data: data});
            if (readData(key.id).colorId !== colorId) {
                var name = colorId === PLUM ? "Plum" : (colorId === SILVER ? "Silver" : String(colorId));
                throw new Error("Cavalry did not retain the " + name + " keyframe color.");
            }
        },
        apply: function (expression, math) {
            math = mathModule(math);
            var validation = math.validate(expression);
            if (!validation.ok) return result(0, 0, [validation.error], {message: validation.error});
            return guarded(function () {
                var snapshot = readSelection(math, {samples: false, preview: false}), changed = 0, errors = [];
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
                flushUpdates(changed, errors);
                return result(changed, snapshot.keys.length - changed, errors, {expression: validation.expression});
            });
        },
        clear: function () {
            return guarded(function () {
                var snapshot = readSelection(null, {samples: false, preview: false}), changed = 0, errors = [];
                for (var i = 0; i < snapshot.keys.length; i++) {
                    var key = snapshot.keys[i];
                    try { api.magicEasing(key.layerId, key.attrId, key.frame, NONE); host.setColor(key, SILVER); changed++; }
                    catch (e) { restoreKey(key); errors.push(key.attrId + ": " + e.message); }
                }
                flushUpdates(changed, errors);
                return result(changed, snapshot.keys.length - changed, errors, {expression: "x"});
            });
        },
        flatten: function (math) {
            math = mathModule(math);
            return guarded(function () {
                var snapshot = readSelection(math, {samples: false, preview: false}), changed = 0, errors = [], fits = [], changedIds = {};
                var selectedLookup = Object.create(null), segmentLookup = Object.create(null);
                for (var selectedIndex = 0; selectedIndex < snapshot.selectedIds.length; selectedIndex++) selectedLookup[snapshot.selectedIds[selectedIndex]] = true;
                for (var segmentIndex = 0; segmentIndex < snapshot.segments.length; segmentIndex++) segmentLookup[snapshot.segments[segmentIndex].a.id] = true;
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
                                if (selectedLookup[pathKey.id] && !changedIds[pathKey.id]) {
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
                    var hasSegment = !!segmentLookup[key.id];
                    // Leave a failed Magic span intact; color ordinary selected keys after success.
                    if ((hasSegment && key.magic.active) || (!key.magic.active && !changed)) continue;
                    try { if (key.magic.active) api.magicEasing(key.layerId, key.attrId, key.frame, NONE); host.setColor(key, SILVER); changedIds[key.id] = true; changed++; }
                    catch (e) { restoreKey(key); errors.push(key.attrId + ": " + e.message); }
                }
                flushUpdates(changed, errors);
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

/* Measey native panel. Original implementation; no external assets or modules. */
function buildMeaseyUI(controller, math) {
    var closed = false, syncing = false, resizing = false;
    var width = 380, sliderWidth = 380, dividerWidth = 380, graphHeight = 210;
    var controlHeight = 28, groupPadding = 3, powerEditing = false, lastWidthLimit = null;
    var lastPresetKey = null, lastThemeKey = null, presetRefs = [];
    var localMode = "value", drag = null, dividerHover = false, guideHover = false, guideDrag = null;
    var endpointHover = null, endpointDrag = null, sliderDragging = false, weightEditor = null, buttons = [];
    var stateSnapshot = null, compiledCache = cache(128), sampleCache = cache(256), pathCache = cache(192);
    var selectionCache = {source:null, key:null, curves:[], value:null, speed:null}, graphScene = null;
    var functionRefs = [], functionSerial = 0;
    ui.setMargins(0, 0, 0, 0);
    ui.setSpaceBetween(0);
    var main = new ui.VLayout();
    main.setMargins(8, 8, 8, 8);
    main.setSpaceBetween(12);

    function state() { return stateSnapshot || (stateSnapshot = controller.getState() || {}); }
    function cache(limit) {
        var values = Object.create(null), order = [];
        return {
            get:function(key) {
                if (!Object.prototype.hasOwnProperty.call(values, key)) return null;
                var index = order.indexOf(key); if (index >= 0) order.splice(index, 1);
                order.push(key); return values[key];
            },
            put:function(key, value) {
                if (Object.prototype.hasOwnProperty.call(values, key)) order.splice(order.indexOf(key), 1);
                values[key] = value; order.push(key);
                if (order.length > limit) delete values[order.shift()];
                return value;
            },
            clear:function() { values = Object.create(null); order = []; }
        };
    }
    function clamp(n, low, high) { return Math.max(low, Math.min(high, n)); }
    function blend(a, b, amount) {
        function channel(s, i) { return parseInt(String(s).replace("#", "").substr(i * 2, 2), 16) || 0; }
        var out = "#";
        for (var i = 0; i < 3; i++) {
            var n = Math.round(channel(a, i) * (1 - amount) + channel(b, i) * amount);
            out += (n < 16 ? "0" : "") + n.toString(16);
        }
        return out;
    }
    function themeColor(key, fallback) {
        try {
            var color = ui.getThemeColor(key);
            return typeof color === "string" && /^#[0-9a-f]{6}/i.test(color) ? color.substr(0, 7) : fallback;
        } catch (e) { return fallback; }
    }
    function colors() {
        var bg = themeColor("Base", "#373737"), text = themeColor("Text", "#ececec");
        return {
            bg: bg, text: text, muted: blend(text, bg, 0.43),
            surface: blend(bg, "#000000", 0.28), raised: blend(bg, text, 0.07),
            grid: "#434343", accent: "#c58bd0",
            selected: blend(bg, "#b486bb", 0.29)
        };
    }
    function call(name, args) {
        if (closed) return;
        if (typeof controller[name] === "function") controller[name].apply(controller, args || []);
        refresh();
    }
    function label(text, size) {
        var widget = new ui.Label(text);
        widget.setFontSize(size || 11);
        return widget;
    }
    function button(text, tooltip, callback, minWidth) {
        var widget = new ui.Button(text);
        widget.setFontSize(12);
        widget.setFixedHeight(controlHeight);
        widget.setCornerRounding(3);
        widget.setContentsMargins(0, 0, 0, 0);
        if (typeof widget.setDrawStroke === "function") widget.setDrawStroke(false);
        if (minWidth) widget.setMinimumWidth(minWidth);
        widget.setToolTip(tooltip);
        widget.onClick = callback;
        buttons.push(widget);
        return widget;
    }
    function group(layout) {
        layout.setMargins(groupPadding, groupPadding, groupPadding, groupPadding);
        layout.setSpaceBetween(3);
        var host = new ui.Container();
        host.setLayout(layout); host.setRadius(5, 5, 5, 5);
        host.setFixedHeight(controlHeight + groupPadding * 2);
        return host;
    }
    function field(widget) {
        widget.setFontSize(13); widget.setFixedHeight(controlHeight);
        widget.setContentsMargins(0, 0, 0, 0);
        widget.setCornerRounding(3);
        widget.setMinimumWidth(1);
        // LineEdit keeps its native rectangular frame on 2.7.2. Matching its
        // surface to a rounded host provides corners and real text padding.
        var row = new ui.HLayout();
        row.setMargins(6, 0, 6, 0); row.setSpaceBetween(0); row.add(widget);
        var host = new ui.Container();
        host.setLayout(row); host.setRadius(3, 3, 3, 3); host.setFixedHeight(controlHeight);
        return {editor:widget, host:host};
    }
    function stroke(canvas, path, color, thickness) {
        canvas.addPath(path.toObject(), { color: color, stroke: true, strokeWidth: thickness || 1 });
    }
    function line(canvas, x1, y1, x2, y2, color, thickness) {
        var path = new cavalry.Path();
        path.moveTo(x1, y1); path.lineTo(x2, y2);
        stroke(canvas, path, color, thickness);
    }
    function expressionFunction(expression) {
        var source = String(expression || "x"), saved = compiledCache.get(source);
        if (saved) { if (saved.error) throw saved.error; return saved.fn; }
        try {
            var compiled = math.compile(source), fn;
            if (typeof compiled === "function") fn = compiled;
            else if (compiled && typeof compiled.evaluate === "function") fn = function(t) { return compiled.evaluate(t); };
            else if (compiled && typeof compiled.value === "function") fn = function(t) { return compiled.value(t); };
            else if (compiled && typeof compiled.fn === "function") fn = compiled.fn;
            else throw new Error("Expression cannot be previewed");
            compiledCache.put(source, {fn:fn}); return fn;
        } catch (error) { compiledCache.put(source, {error:error}); throw error; }
    }
    function curveSignature(curve) {
        if (typeof curve === "string") return "expression:" + curve;
        if (curve && typeof curve.evaluate === "function") {
            for (var i = 0; i < functionRefs.length; i++) if (functionRefs[i].fn === curve.evaluate) return "function:" + functionRefs[i].id;
            var ref = {fn:curve.evaluate, id:++functionSerial}; functionRefs.push(ref);
            if (functionRefs.length > 128) functionRefs.shift();
            return "function:" + ref.id;
        }
        if (curve && curve.samples && curve.samples.length > 1) return "samples:" + JSON.stringify(curve.samples);
        if (curve && curve.bezier) {
            var b = curve.bezier;
            return "bezier:" + JSON.stringify(Array.isArray(b) ? b : [b.x1, b.y1, b.x2, b.y2]);
        }
        return "expression:" + (curve && curve.expression || "x");
    }
    function curveFunction(curve) {
        if (typeof curve === "string") return expressionFunction(curve);
        if (curve && typeof curve.evaluate === "function") return curve.evaluate;
        if (curve && curve.samples && curve.samples.length > 1) {
            var points = curve.samples;
            return function(t) {
                if (t <= points[0].x) return points[0].y;
                if (t >= points[points.length - 1].x) return points[points.length - 1].y;
                var low = 1, high = points.length - 1;
                while (low < high) {
                    var middle = Math.floor((low + high) / 2);
                    if (points[middle].x < t) low = middle + 1; else high = middle;
                }
                var span = points[low].x - points[low - 1].x;
                if (span <= 0) return points[low].y;
                var amount = (t - points[low - 1].x) / span;
                return points[low - 1].y + (points[low].y - points[low - 1].y) * amount;
            };
        }
        if (curve && curve.bezier) {
            var bezier = curve.bezier;
            if (Array.isArray(bezier)) bezier = { x1: bezier[0], y1: bezier[1], x2: bezier[2], y2: bezier[3] };
            return function(t) { return math.bezierValue(t, bezier); };
        }
        return expressionFunction(curve && curve.expression || "x");
    }
    function samples(fn, count, speed) {
        var out = [], eps = 0.0005;
        for (var i = 0; i <= count; i++) {
            var t = i / count, y;
            if (speed) {
                var lo = Math.max(0, t - eps), hi = Math.min(1, t + eps);
                y = (fn(hi) - fn(lo)) / (hi - lo);
            } else y = fn(t);
            if (typeof y !== "number" || !isFinite(y)) throw new Error("Non-finite curve");
            out.push({ t: t, y: y });
        }
        return out;
    }
    function cachedSamples(curve, count, speed, signature) {
        var key = (speed ? "speed:" : "value:") + count + ":" + (signature || curveSignature(curve));
        var saved = sampleCache.get(key); if (saved) return saved;
        try {
            var values = samples(curveFunction(curve), count, speed), low = 0, high = 1, ordinates = [];
            for (var i = 0; i < values.length; i++) {
                low = Math.min(low, values[i].y); high = Math.max(high, values[i].y); ordinates.push(values[i].y);
            }
            return sampleCache.put(key, {values:values, low:low, high:high, geometry:count + ":" + JSON.stringify(ordinates)});
        } catch (error) { return sampleCache.put(key, {error:error}); }
    }
    function selectionSamples(curves, speed) {
        if (selectionCache.source !== curves) {
            var unique = [], signatures = [], seen = Object.create(null);
            for (var i = 0; i < curves.length; i++) {
                var signature = curveSignature(curves[i]);
                if (seen[signature]) continue;
                seen[signature] = true; unique.push(curves[i]); signatures.push(signature);
            }
            var key = JSON.stringify(signatures);
            if (key !== selectionCache.key) {
                selectionCache = {source:curves, key:key, curves:unique, signatures:signatures, value:null, speed:null};
            } else selectionCache.source = curves;
        }
        var modeKey = speed ? "speed" : "value";
        if (selectionCache[modeKey]) return selectionCache[modeKey];
        var out = [], geometries = Object.create(null);
        for (var j = 0; j < selectionCache.curves.length; j++) {
            var data = cachedSamples(selectionCache.curves[j], 150, speed, selectionCache.signatures[j]);
            if (data.error || geometries[data.geometry]) continue;
            geometries[data.geometry] = true; out.push(data);
        }
        selectionCache[modeKey] = out; return out;
    }
    function samplePath(values, box, low, high, geometry) {
        var key = (geometry || JSON.stringify(values)) + ":" + [box.x, box.y, box.w, box.h, low, high].join(",");
        var saved = pathCache.get(key); if (saved) return saved;
        var path = new cavalry.Path(), range = Math.max(0.00001, high - low);
        for (var i = 0; i < values.length; i++) {
            var x = box.x + values[i].t * box.w;
            var y = box.y + (values[i].y - low) / range * box.h;
            if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
        }
        return pathCache.put(key, path.toObject());
    }
    function drawSamples(canvas, values, box, low, high, color, thickness, geometry) {
        canvas.addPath(samplePath(values, box, low, high, geometry), {color:color, stroke:true, strokeWidth:thickness || 1});
    }

    var tabs = new ui.HLayout();
    tabs.setMargins(0, 0, 0, 0); tabs.setSpaceBetween(3);
    var valueButton = button("Value", "Preview the normalized easing curve", function() { setMode("value"); });
    var speedButton = button("Speed", "Preview the change in value over time", function() { setMode("speed"); });
    tabs.add(valueButton, speedButton);
    var tabGroup = group(tabs);

    var graph = new ui.Draw();
    graph.setSize(width, graphHeight);
    graph.setMinimumWidth(160);
    graph.setTransparentForMouseEvents(true);
    graph.setToolTip("Curve preview follows the selected keyframes. Drag the divider below to resize.");
    var graphRow = new ui.HLayout();
    graphRow.setMargins(0, 0, 0, 0); graphRow.setSpaceBetween(0); graphRow.add(graph);
    var graphHost = new ui.Container();
    graphHost.setLayout(graphRow);
    graphHost.setFixedHeight(graphHeight);
    graphHost.useHoverEvents(true);
    var dividerCanvas = new ui.Draw();
    dividerCanvas.setSize(width, 9);
    dividerCanvas.setTransparentForMouseEvents(true);
    var dividerRow = new ui.HLayout();
    dividerRow.setMargins(0, 0, 0, 0); dividerRow.setSpaceBetween(0); dividerRow.add(dividerCanvas);
    var divider = new ui.Container();
    divider.setLayout(dividerRow); divider.setFixedHeight(9);
    divider.useHoverEvents(true);
    divider.setToolTip("Drag to resize the curve preview. Double-click to reset.");

    var inputField = field(new ui.LineEdit()), input = inputField.editor;
    input.setMinimumWidth(55);
    input.setPlaceholder("Magic expression, e.g. x^3");
    input.setToolTip("Use x from 0 to 1 (t is also accepted). Apply with the checkmark, or turn on Apply on type in Settings.");
    input.onValueChanged = function() {
        if (!syncing && !closed) call("editExpression", [input.getText(), false]);
    };
    input.onValueCommitted = function() {
        if (!syncing && !closed) call("editExpression", [input.getText(), true]);
    };
    var getButton = button("→", "Get the selected keyframes' expression into the custom field", function() { call("getSelection"); });
    getButton.setFixedWidth(controlHeight);
    var applyButton = button("✓", "Apply the custom expression to the selected keyframes", function() { call("apply"); });
    applyButton.setFixedWidth(controlHeight);
    var settingsButton = button("⚙", "Measey settings", function() { call("showSettings"); });
    settingsButton.setFixedWidth(controlHeight);
    var inputRow = new ui.HLayout();
    inputRow.setMargins(0, 0, 0, 0); inputRow.setSpaceBetween(4);
    inputRow.add(getButton, inputField.host, applyButton, settingsButton);
    var inputGroup = group(inputRow);
    main.add(tabGroup);
    // Keep the graph, handle and Power section's existing six-pixel rhythm.
    var graphBlock = new ui.VLayout();
    graphBlock.setMargins(0, 0, 0, 0); graphBlock.setSpaceBetween(6);
    graphBlock.add(graphHost, divider);

    var directions = ["in", "in out", "out"], directionCaptions = ["In", "Both", "Out"];
    // Cavalry 2.7.2 does not expose the SegmentedControl in newer docs.
    // Native Buttons keep the direction strip keyboard accessible on 2.7.2.
    var directionRow = new ui.HLayout(), directionButtons = [];
    directionRow.setMargins(0, 0, 0, 0); directionRow.setSpaceBetween(3);
    directions.forEach(function(direction, index) {
        var control = button(directionCaptions[index], "Preview " + directionCaptions[index] + " Power easing. Apply on direction can be enabled in Settings.", function() {
            call("setDirection", [direction]);
        });
        directionButtons.push(control); directionRow.add(control);
    });
    var directionGroup = group(directionRow);

    var powerRow = new ui.HLayout();
    powerRow.setMargins(0, 0, 0, 0); powerRow.setSpaceBetween(6);
    var powerLabel = label("POWER", 12);
    var headingWidth = 54, headingGap = 12;
    powerLabel.setFixedWidth(headingWidth);
    var selectedPowerLabel = label("", 11);
    selectedPowerLabel.setMinimumWidth(0);
    var numericField = field(new ui.LineEdit()), powerField = numericField.editor;
    numericField.host.setFixedWidth(76);
    powerField.setToolTip("Power 1 or above. Type precise values using . or ,; the slider uses whole numbers from 1 to 12.");
    var powerSliderCanvas = new ui.Draw();
    var sliderHeight = controlHeight + groupPadding * 2;
    powerSliderCanvas.setSize(sliderWidth, sliderHeight); powerSliderCanvas.setTransparentForMouseEvents(true);
    var sliderRow = new ui.HLayout();
    sliderRow.setMargins(0, 0, 0, 0); sliderRow.setSpaceBetween(0); sliderRow.add(powerSliderCanvas);
    var powerSlider = new ui.Container();
    powerSlider.setLayout(sliderRow); powerSlider.setFixedHeight(sliderHeight); powerSlider.useHoverEvents(true);
    powerSlider.setToolTip("Drag Power from 1 to 12. The numeric field also accepts keyboard entry.");
    powerField.onValueChanged = function() {
        if (!syncing && !closed) powerEditing = true;
    };
    powerField.onValueCommitted = function() {
        if (syncing || closed) return;
        var entered = powerField.getText();
        powerEditing = false;
        call("setPower", [entered, true, "numeric"]);
    };
    powerRow.setSpaceBetween(headingGap);
    powerRow.add(powerLabel, selectedPowerLabel); powerRow.addStretch(); powerRow.add(numericField.host);
    var powerBlock = new ui.VLayout();
    powerBlock.setMargins(0, 0, 0, 0); powerBlock.setSpaceBetween(6);
    powerBlock.add(powerRow, powerSlider);
    main.add(graphBlock);
    main.add(inputGroup);
    main.add(powerBlock);
    main.add(directionGroup);

    var actionRow = new ui.HLayout();
    actionRow.setMargins(0, 0, 0, 0); actionRow.setSpaceBetween(6);
    var applyPowerLabel = label("Apply", 12);
    applyPowerLabel.setAlignment(1); applyPowerLabel.setTransparentForMouseEvents(true);
    var applyPowerRow = new ui.HLayout();
    applyPowerRow.setMargins(6, 0, 6, 0); applyPowerRow.add(applyPowerLabel);
    var applyPowerButton = new ui.Container();
    applyPowerButton.setLayout(applyPowerRow); applyPowerButton.setRadius(3, 3, 3, 3);
    applyPowerButton.setFixedHeight(controlHeight); applyPowerButton.setMinimumWidth(40);
    applyPowerButton.onMouseRelease = function(position, buttonName) {
        if (buttonName === "left" && state().canApplyPower !== false) call("applyPower");
    };
    buttons.push(applyPowerButton);
    var flattenButton = button("≈", "Flatten selected magic expressions to Bézier keyframes and set their color to Silver", function() { call("flatten"); });
    var clearButton = button("×", "Clear selected magic expressions and set their color to Silver", function() { call("clear"); });
    flattenButton.setFixedWidth(28); clearButton.setFixedWidth(28);
    actionRow.add(applyPowerButton, flattenButton, clearButton);
    var actionGroup = group(actionRow);
    main.add(actionGroup);

    var presetHeader = new ui.HLayout();
    presetHeader.setMargins(0, 4, 0, 0);
    var presetTitle = label("LIBRARY", 11), libraryNameLabel = label("", 11);
    presetTitle.setFixedWidth(headingWidth);
    presetHeader.setSpaceBetween(headingGap);
    var libraryButton = button("⋯", "Library settings", function() { call("showLibrarySettings"); });
    libraryButton.setFixedWidth(28);
    presetTitle.setFixedHeight(18);
    presetHeader.add(presetTitle, libraryNameLabel); presetHeader.addStretch(); presetHeader.add(libraryButton);
    main.add(presetHeader);
    var presetLayout = new ui.VLayout();
    presetLayout.setMargins(0, 0, 0, 0); presetLayout.setSpaceBetween(5);
    main.add(presetLayout);
    main.addStretch();
    var outerScroll = new ui.ScrollView();
    outerScroll.setLayout(main);
    ui.add(outerScroll);
    ui.setMinimumWidth(220);
    ui.setMinimumHeight(260);

    function refreshPresetHeader() {
        var fullName = String(state().libraryName || "None");
        var titleWidth = Math.max(20, width - headingWidth - headingGap * 3 - 28);
        var maxCharacters = Math.max(8, Math.floor(titleWidth / 6.4));
        var displayName = fullName;
        if (displayName.length > maxCharacters) displayName = displayName.slice(0, maxCharacters - 1) + "…";
        libraryNameLabel.setFixedWidth(titleWidth);
        libraryNameLabel.setText(displayName);
        libraryNameLabel.setToolTip(fullName);
        var powers = (state().selectedPowerLevels || []).join(", ");
        var levelWidth = Math.max(0, width - headingWidth - headingGap * 3 - 76);
        var levelCharacters = Math.max(1, Math.floor(levelWidth / 6.4));
        selectedPowerLabel.setFixedWidth(levelWidth);
        selectedPowerLabel.setText(powers.length > levelCharacters ? powers.slice(0, Math.max(0, levelCharacters - 1)) + "…" : powers);
        selectedPowerLabel.setToolTip(powers);
    }

    function setMode(mode) {
        if (closed) return;
        localMode = mode;
        if (typeof controller.savePreferences === "function") controller.savePreferences({ mode: mode });
        refresh();
    }
    function mode() { return state().mode || localMode; }
    function bothMidpoint() {
        var value = Number(state().bothMidpoint);
        return isFinite(value) && value >= 0.01 && value <= 0.99 ? value : 0.5;
    }
    function powerSelected() { return state().powerSelected !== false; }
    function plotBox() { return {x:1.5, y:2, w:Math.max(80, width - 3), h:Math.max(65, graphHeight - 4)}; }
    function guideX() { return 1.5 + bothMidpoint() * Math.max(80, width - 3); }
    function graphLocalX(position) {
        if (!position) return null;
        var x = Number(position.x);
        if (!isFinite(x)) return null;
        try {
            var host = graphHost.geometry(), canvas = graph.geometry();
            var offset = Number(canvas.left) - Number(host.left);
            if (isFinite(offset)) x -= offset;
        } catch (e) {}
        return x;
    }
    function guideHit(position) {
        var x = graphLocalX(position), y = position ? Number(position.y) : NaN, box = plotBox();
        return powerSelected() && state().direction === "in out" && x !== null && isFinite(y) &&
            y >= box.y && y <= box.y + box.h && Math.abs(x - guideX()) <= 7;
    }
    function endpointActive(side) {
        var direction = state().direction || "out";
        return powerSelected() && (direction === "in out" || direction === (side === "bottom" ? "in" : "out"));
    }
    function endpointValue(side) {
        var value = Number(state()[side]);
        return isFinite(value) ? clamp(value, 0, 1) : 0;
    }
    function endpointBounds(side, pressed) {
        var box = plotBox(), span = box.h / 2 - 14;
        // Native graph mouse positions use Y-up coordinates. Each endpoint
        // occupies its own half, with a twelve-pixel gap at the maximum.
        var y = side === "bottom" ? box.y + 8 + endpointValue(side) * span : box.y + box.h - 8 - endpointValue(side) * span;
        return {x:box.x + (pressed ? 0 : 6), y:y - 1.5, w:box.w - (pressed ? 0 : 12), h:3, centreY:y, span:span};
    }
    function endpointHit(position) {
        if (!position) return null;
        var x = graphLocalX(position), y = Number(position.y), box = plotBox();
        if (x === null || !isFinite(y)) return null;
        var sides = ["bottom", "top"];
        for (var i = 0; i < sides.length; i++) {
            if (!endpointActive(sides[i])) continue;
            var bounds = endpointBounds(sides[i], false);
            // Preserve a central click target for the midpoint guide even
            // when both endpoint handles are at their maximum values.
            if (sides[i] === "bottom" ? y > box.y + box.h / 2 - 2 : y < box.y + box.h / 2 + 2) continue;
            if (x >= bounds.x - 4 && x <= bounds.x + bounds.w + 4 && Math.abs(y - bounds.centreY) <= 7) return sides[i];
        }
        return null;
    }
    function handleColor(c, pressed, hovered) {
        return pressed ? c.accent : hovered ? c.selected : "#434343";
    }
    function weightActive(kind) {
        return kind === "midpoint" ? powerSelected() && state().direction === "in out" :
            (kind === "bottom" || kind === "top") && endpointActive(kind);
    }
    function drawGraph() {
        var s = state(), c = colors(), speed = mode() === "speed";
        graph.clearPaths(); graph.setBackgroundColor(c.bg);
        var box = plotBox();
        var selected = selectionSamples(s.selectionPreviewCurves || [], speed);
        var currentExpression = s.powerExpression || (powerSelected() ? math.powerExpression(Number(s.power) || 4, s.direction || "out", bothMidpoint(), endpointValue("bottom"), endpointValue("top")) : "");
        var power = currentExpression ? cachedSamples(currentExpression, 150, speed) : null;
        if (power && power.error) power = null;
        if (!graphScene || graphScene.selected !== selected || graphScene.power !== power || graphScene.width !== width || graphScene.height !== graphHeight) {
            var low = 0, high = 1, paths = [];
            for (var i = 0; i < selected.length; i++) { low = Math.min(low, selected[i].low); high = Math.max(high, selected[i].high); }
            if (power) { low = Math.min(low, power.low); high = Math.max(high, power.high); }
            if (speed) {
                high = Math.max(1, high * 1.05);
                if (low < 0) low *= 1.05;
            } else if (low < 0 || high > 1) {
                var pad = (high - low) * 0.05; low -= pad; high += pad;
            }
            // Keep every unique selected shape. If Power has the same shape,
            // its accent path replaces the coincident grey path underneath.
            for (var j = 0; j < selected.length; j++) {
                if (!power || power.geometry !== selected[j].geometry) paths.push({path:samplePath(selected[j].values, box, low, high, selected[j].geometry), power:false});
            }
            if (power) paths.push({path:samplePath(power.values, box, low, high, power.geometry), power:true});
            // One active scene retains all its paths; historical caches have
            // fixed limits. Hover changes only handles and their value labels.
            graphScene = {selected:selected, power:power, width:width, height:graphHeight, paths:paths};
        }
        for (var grid = 0; grid <= 5; grid++) {
            var ratio = grid / 5;
            line(graph, box.x + ratio * box.w, box.y, box.x + ratio * box.w, box.y + box.h, c.grid);
            line(graph, box.x, box.y + ratio * box.h, box.x + box.w, box.y + ratio * box.h, c.grid);
        }
        var weightLabels = [];
        function weightLabel(value, x, y, rightAligned) {
            var path = new cavalry.Path();
            path.addText(String(value), 10, 0, 0);
            var textWidth = path.boundingBox().width;
            path.translate(clamp(rightAligned ? x - textWidth : x, box.x + 3, box.x + box.w - textWidth - 3),
                clamp(y, box.y + 3, box.y + box.h - 12));
            weightLabels.push(path);
        }
        ["bottom", "top"].forEach(function(side) {
            if (!endpointActive(side)) return;
            var pressed = endpointDrag && endpointDrag.side === side, bounds = endpointBounds(side, pressed);
            graph.addPath(roundedPath(bounds.x, bounds.y, bounds.w, bounds.h, 1.5).toObject(), {color:handleColor(c, pressed, endpointHover === side)});
            if (pressed || endpointHover === side) {
                if (side === "bottom") weightLabel(endpointValue(side), box.x + box.w - 6, bounds.centreY + 6, true);
                else weightLabel(endpointValue(side), box.x + 6, bounds.centreY - 14, false);
            }
        });
        if (powerSelected() && s.direction === "in out") {
            // Grow only along Y, above the grid and within the plot.
            var inset = guideDrag ? 0 : 6, left = guideX() - 1.5;
            var bottom = box.y + inset, top = box.y + box.h - inset;
            var guidePath = new cavalry.Path();
            guidePath.moveTo(left, bottom); guidePath.lineTo(left + 3, bottom);
            guidePath.lineTo(left + 3, top); guidePath.lineTo(left, top); guidePath.close();
            graph.addPath(guidePath.toObject(), {color:handleColor(c, guideDrag, guideHover)});
            if (guideDrag || guideHover) weightLabel(bothMidpoint(), guideX() + 6, box.y + box.h / 2, false);
        }
        for (var k = 0; k < graphScene.paths.length; k++) {
            var curve = graphScene.paths[k];
            graph.addPath(curve.path, {color:curve.power ? c.accent : c.muted, stroke:true, strokeWidth:curve.power ? 2.3 : 1.3});
        }
        for (var text = 0; text < weightLabels.length; text++) graph.addPath(weightLabels[text].toObject(), {color:c.muted, stroke:false});
        graph.redraw();
    }
    function drawDivider() {
        var c = colors();
        dividerCanvas.clearPaths(); divider.setBackgroundColor(c.bg); dividerCanvas.setBackgroundColor(c.bg);
        var length = drag ? 78 : 54, thickness = 3;
        dividerCanvas.addPath(roundedPath(Math.max(0, (dividerWidth - length) / 2), (9 - thickness) / 2, length, thickness, thickness / 2).toObject(), {color:handleColor(c, drag, dividerHover)});
        dividerCanvas.redraw();
    }
    function roundedPath(x, y, w, h, radius) {
        var p = new cavalry.Path(), r = Math.max(0, Math.min(radius, w / 2, h / 2)), k = r * 0.55228475;
        p.moveTo(x + r, y); p.lineTo(x + w - r, y);
        p.cubicTo(x + w - r + k, y, x + w, y + r - k, x + w, y + r);
        p.lineTo(x + w, y + h - r);
        p.cubicTo(x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h);
        p.lineTo(x + r, y + h);
        p.cubicTo(x + r - k, y + h, x, y + h - r + k, x, y + h - r);
        p.lineTo(x, y + r); p.cubicTo(x, y + r - k, x + r - k, y, x + r, y); p.close();
        return p;
    }
    function maxPower() { return Math.max(1.1, Number(state().maxPower) || 12); }
    function allocatedWidth(host, fallback) {
        try {
            var bounds = host.geometry(), measured = Number(bounds.width);
            if (isFinite(measured) && measured > 0) return Math.floor(measured);
        } catch (e) {}
        return fallback;
    }
    function syncCanvasWidths() {
        // A Draw can be centered within its stretchable Container. Measure the
        // allocated row, including scrollbar space, rather than the window.
        var dimensions = ui.size(), rootWidth = Number(dimensions.width === undefined ? dimensions.x : dimensions.width);
        var limit = Math.max(160, isFinite(rootWidth) && rootWidth > 0 ? Math.floor(rootWidth - 16) : width);
        if (limit !== lastWidthLimit) {
            lastWidthLimit = limit;
            graphHost.setMaximumWidth(limit); powerSlider.setMaximumWidth(limit); divider.setMaximumWidth(limit);
        }
        var graphWidth = Math.min(limit, allocatedWidth(graphHost, limit));
        var trackWidth = Math.min(limit, allocatedWidth(powerSlider, graphWidth));
        var handleWidth = Math.min(limit, allocatedWidth(divider, graphWidth));
        var changed = graphWidth !== width || trackWidth !== sliderWidth || handleWidth !== dividerWidth;
        if (graphWidth !== width) { width = graphWidth; graph.setSize(width, graphHeight); graph.setMinimumWidth(160); }
        if (trackWidth !== sliderWidth) { sliderWidth = trackWidth; powerSliderCanvas.setSize(sliderWidth, sliderHeight); powerSliderCanvas.setMinimumWidth(0); }
        if (handleWidth !== dividerWidth) { dividerWidth = handleWidth; dividerCanvas.setSize(dividerWidth, 9); dividerCanvas.setMinimumWidth(0); }
        return changed;
    }
    function sliderMarker(value) {
        return 7.5 + (clamp(value, 1, maxPower()) - 1) / (maxPower() - 1) * Math.max(1, sliderWidth - 15);
    }
    function drawPowerSlider() {
        var c = colors(), value = clamp(Number(state().power) || 4, 1, maxPower());
        var marker = sliderMarker(value);
        powerSliderCanvas.clearPaths(); powerSliderCanvas.setBackgroundColor(c.bg);
        powerSliderCanvas.addPath(roundedPath(0, 0, sliderWidth, sliderHeight, 5).toObject(), {color:c.raised});
        if (powerSelected()) powerSliderCanvas.addPath(roundedPath(3, 3, marker + 1.5, sliderHeight - 6, 3).toObject(), {color:c.selected});
        // Centered step marks share the handle's exact x mapping, below it.
        for (var step = 1; step <= maxPower(); step++) {
            powerSliderCanvas.addPath(roundedPath(sliderMarker(step) - 1, sliderHeight / 2 - 3, 2, 6, 0).toObject(), {color:"#373737"});
        }
        if (powerSelected()) powerSliderCanvas.addPath(roundedPath(marker - 1.5, 6, 3, sliderHeight - 12, 1.5).toObject(), {color:c.accent});
        powerSliderCanvas.redraw();
    }
    function sliderPosition(position, committed) {
        if (closed || !position || !isFinite(position.x)) return;
        syncCanvasWidths();
        var ratio = clamp((position.x - 7.5) / Math.max(1, sliderWidth - 15), 0, 1);
        var value = Math.round(1 + ratio * (maxPower() - 1));
        powerEditing = false;
        if (!powerSelected() || committed || value !== Number(state().power)) call("setPower", [value, committed, "slider"]);
    }
    powerSlider.onMousePress = function(position, buttonName) {
        if (closed || buttonName !== "left") return;
        sliderDragging = true; sliderPosition(position, false);
    };
    powerSlider.onMouseMove = function(position) {
        if (sliderDragging) sliderPosition(position, false);
    };
    powerSlider.onMouseRelease = function(position, buttonName) {
        if (!sliderDragging) return;
        sliderDragging = false;
        if (buttonName === undefined || buttonName === "left") {
            if (position && isFinite(position.x)) sliderPosition(position, true);
            else call("setPower", [Math.round(Number(state().power)), true, "slider"]);
        }
    };
    function moveGuide(position, committed) {
        var x = graphLocalX(position);
        if (!guideDrag || x === null || state().direction !== "in out") return;
        if (!guideDrag.moved && Math.abs(x - guideDrag.startX) >= 3) guideDrag.moved = true;
        if (!guideDrag.moved) return;
        var value = clamp(Math.round((x - guideDrag.offset - 1.5) / Math.max(80, width - 3) * 100) / 100, 0.01, 0.99);
        if (committed || value !== bothMidpoint()) call("setBothMidpoint", [value, committed, "drag"]);
    }
    function moveEndpoint(position, committed) {
        if (!position) return;
        var y = Number(position.y);
        if (!endpointDrag || !isFinite(y) || !endpointActive(endpointDrag.side)) return;
        if (!endpointDrag.moved && Math.abs(y - endpointDrag.startY) >= 2) endpointDrag.moved = true;
        if (!endpointDrag.moved) return;
        var side = endpointDrag.side, box = plotBox(), bounds = endpointBounds(side, true);
        var target = y - endpointDrag.offset;
        var amount = side === "bottom" ? target - box.y - 8 : box.y + box.h - 8 - target;
        var value = clamp(Math.round(amount / bounds.span * 100) / 100, 0, 1);
        if (committed || value !== endpointValue(side)) call("setEndpoint", [side, value, committed, "drag"]);
    }
    function updateGraphHover(position) {
        endpointHover = endpointHit(position);
        guideHover = !endpointHover && guideHit(position);
    }
    graphHost.onMousePress = function(position, buttonName) {
        if (closed) return;
        syncCanvasWidths();
        var side = endpointHit(position);
        if (side) {
            guideDrag = null; guideHover = false;
            if (buttonName === "right") {
                endpointDrag = null; call("setEndpoint", [side, 0, true, "numeric"]);
                updateGraphHover(position); drawGraph();
            } else if (buttonName === "left") {
                var bounds = endpointBounds(side, false);
                endpointDrag = {side:side, startY:Number(position.y), offset:Number(position.y) - bounds.centreY, moved:false};
                endpointHover = side; drawGraph();
            }
            return;
        }
        if (!guideHit(position)) {
            if (buttonName === "right") {
                endpointDrag = null; guideDrag = null; endpointHover = null; guideHover = false;
                if (weightEditor) weightEditor.dismiss();
                drawGraph();
                ui.clearContextMenu();
                ui.addMenuItem({name:"Reset Weights", onMouseRelease:function() { call("resetWeights"); }});
                ui.showContextMenu();
            }
            return;
        }
        if (buttonName === "right") {
            endpointDrag = null; endpointHover = null; guideDrag = null;
            call("setBothMidpoint", [0.5, true, "numeric"]);
            if (!closed) { guideHover = guideHit(position); drawGraph(); }
            return;
        }
        if (buttonName !== "left") return;
        syncCanvasWidths();
        var x = graphLocalX(position);
        endpointDrag = null; endpointHover = null;
        guideDrag = {startX:x, offset:x - guideX(), moved:false};
        guideHover = true; drawGraph();
    };
    graphHost.onMouseMove = function(position) {
        if (closed) return;
        if (endpointDrag) { moveEndpoint(position, false); return; }
        if (guideDrag) { moveGuide(position, false); return; }
        var oldEndpoint = endpointHover, oldGuide = guideHover;
        updateGraphHover(position);
        if (oldEndpoint !== endpointHover || oldGuide !== guideHover) drawGraph();
    };
    graphHost.onMouseRelease = function(position, buttonName) {
        if (closed) return;
        if (endpointDrag) {
            var side = endpointDrag.side, released = buttonName === undefined || buttonName === "left";
            if (released) {
                if (position) moveEndpoint(position, true);
                else if (endpointDrag.moved) call("setEndpoint", [endpointDrag.side, endpointValue(endpointDrag.side), true, "drag"]);
            }
            var clicked = released && endpointDrag && !endpointDrag.moved;
            endpointDrag = null; updateGraphHover(position); drawGraph();
            if (clicked && endpointActive(side)) call("openWeightEditor", [side]);
            return;
        }
        if (!guideDrag) return;
        if (buttonName !== undefined && buttonName !== "left") { guideDrag = null; drawGraph(); return; }
        // Native input may deliver only press/release; use the final position.
        if (position) moveGuide(position, true);
        else if (guideDrag.moved) call("setBothMidpoint", [bothMidpoint(), true, "drag"]);
        var clicked = !guideDrag.moved;
        guideDrag = null; guideHover = guideHit(position); drawGraph();
        if (clicked && state().direction === "in out") call("openWeightEditor", ["midpoint"]);
    };
    graphHost.onMouseEnter = function(position) {
        if (closed) return;
        updateGraphHover(position); drawGraph();
    };
    graphHost.onMouseLeave = function() { if (!closed) { guideHover = false; endpointHover = null; drawGraph(); } };
    divider.onMousePress = function(position, buttonName) {
        if (closed || buttonName !== "left") return;
        drag = { y: position.y };
        drawDivider(true);
    };
    divider.onMouseMove = function(position) {
        if (!drag || closed) return;
        // Native mouse positions use y-up coordinates. The divider itself moves
        // with each resize, so compensate using the current graph height.
        var height = graphHeight + drag.y - position.y;
        if (isFinite(height)) resize(Math.round(height));
    };
    divider.onMouseRelease = function(position, buttonName) {
        if (!drag) return;
        // Some native input sources deliver only press/release for a drag.
        // Apply the final pointer position as well as intermediate moves.
        if (position && (buttonName === undefined || buttonName === "left") && isFinite(position.y) && position.y !== drag.y) {
            var finalHeight = graphHeight + drag.y - position.y;
            if (isFinite(finalHeight)) resize(Math.round(finalHeight));
        }
        drag = null;
        if (typeof controller.savePreferences === "function") controller.savePreferences({ graphHeight: graphHeight });
        drawDivider(false);
    };
    divider.onMouseDoubleClick = function(position, buttonName) {
        if (closed || buttonName !== "left") return;
        drag = null; resize(210);
        if (typeof controller.savePreferences === "function") controller.savePreferences({ graphHeight: graphHeight });
    };
    divider.onMouseEnter = function() { if (!closed) { dividerHover = true; drawDivider(); } };
    divider.onMouseLeave = function() { if (!closed) { dividerHover = false; drawDivider(); } };

    function openWeightEditor(kind) {
        if (closed || !weightActive(kind)) return;
        if (weightEditor) weightEditor.dismiss();
        var isMidpoint = kind === "midpoint", minimum = isMidpoint ? 0.01 : 0, maximum = isMidpoint ? 0.99 : 1;
        var title = isMidpoint ? "Midpoint" : kind === "bottom" ? "Bottom weight" : "Top weight";
        var caption = isMidpoint ? "Adjust mid point" : title;
        var current = isMidpoint ? bothMidpoint() : endpointValue(kind);
        // The graph handles remain the sliders. Cavalry's native input modal
        // supplies a reliable titled editor without a secondary Container.
        var alive = true, editorRef = {kind:kind, dismiss:function() {
            alive = false;
            if (weightEditor === editorRef) weightEditor = null;
        }};
        weightEditor = editorRef;
        var entered;
        try { entered = new ui.Modal().showStringInput(title, caption, String(current)); }
        finally { if (weightEditor === editorRef) weightEditor = null; }
        if (!alive || closed || !weightActive(kind)) return;
        var text = entered === null || entered === undefined ? "" : String(entered).trim();
        if (!text) return; // Cancel and an empty entry leave the value unchanged.
        var number = /^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(text) ? Number(text.replace(",", ".")) : NaN;
        if (!isFinite(number) || number < minimum || number > maximum) {
            new ui.Modal().showMessage("Enter a " + title.toLowerCase() + " from " + minimum + " to " + maximum + ".");
            return;
        }
        if (isMidpoint) call("setBothMidpoint", [number, true, "numeric"]);
        else call("setEndpoint", [kind, number, true, "numeric"]);
    }
    function openMidpointEditor() { openWeightEditor("midpoint"); }

    function drawThumbnail(canvas, preset, size, c, selected) {
        canvas.clearPaths();
        canvas.setBackgroundColor(selected ? c.selected : c.surface);
        var inset = size > 40 ? Math.round(size * 0.14) : 4;
        var box = { x: inset, y: inset, w: size - inset * 2, h: size - inset * 2 };
        try {
            var data = cachedSamples(preset.expression || "x", 56, false);
            if (data.error) throw data.error;
            drawSamples(canvas, data.values, box, data.low, data.high, selected ? c.accent : c.text, size > 40 ? 1.7 : 1.4, data.geometry);
        } catch (e) { line(canvas, inset, inset, size - inset, size - inset, c.muted, 1.5); }
        canvas.redraw();
    }
    function presetItem(preset, index, tileSize, isGrid, c) {
        var id = preset.id === undefined ? index : preset.id;
        var size = isGrid ? tileSize : 29;
        var thumb = new ui.Draw();
        thumb.setSize(size, size); thumb.setTransparentForMouseEvents(true);
        var familyName = String(preset.name || "PRESET").toUpperCase();
        var nameSize = isGrid ? clamp(Math.floor(tileSize / Math.max(1, familyName.length * 0.58)), 8, 11) : 12;
        var name = label(familyName, nameSize);
        name.setTransparentForMouseEvents(true);
        var type = label(String(preset.type || "").toLowerCase(), isGrid ? 10 : 11);
        type.setTransparentForMouseEvents(true);
        var content = isGrid ? new ui.VLayout() : new ui.HLayout();
        content.setMargins(isGrid ? 0 : 5, isGrid ? 0 : 4, isGrid ? 0 : 5, isGrid ? 0 : 4);
        content.setSpaceBetween(isGrid ? 3 : 9);
        content.add(thumb); content.add(name); content.add(type);
        if (!isGrid) content.addStretch();
        var host = new ui.Container();
        host.setLayout(content); host.setRadius(3, 3, 3, 3); host.useHoverEvents(true);
        if (isGrid) {
            host.setFixedWidth(tileSize); host.setFixedHeight(tileSize + 34);
            name.setFixedWidth(tileSize); type.setFixedWidth(tileSize);
        } else host.setFixedHeight(37);
        host.setToolTip(String(preset.name || "PRESET") + (preset.type ? " " + preset.type : "") + "\n" + (preset.expression || "Clear magic expression"));
        var ref = { host: host, thumb: thumb, name: name, type: type, preset: preset, id: id, size: size, hover: false, isGrid: isGrid };
        function paint() {
            if (closed) return;
            var tokens = colors(), selected = state().selectedPreset === id;
            host.setBackgroundColor(selected ? tokens.selected : ref.hover ? blend(tokens.bg, tokens.accent, 0.08) : tokens.bg);
            name.setTextColor(selected ? tokens.text : tokens.muted); type.setTextColor(tokens.muted);
            drawThumbnail(thumb, preset, size, tokens, selected);
        }
        host.onMousePress = function(position, buttonName) {
            if (closed) return;
            if (buttonName === "left") call("selectPreset", [id]);
            else if (buttonName === "right") {
                ui.clearContextMenu();
                ui.addMenuItem({name:"Delete Preset", onMouseRelease:function() { call("deletePreset", [id]); }});
                ui.showContextMenu();
            }
        };
        host.onMouseEnter = function() { ref.hover = true; paint(); };
        host.onMouseLeave = function() { ref.hover = false; paint(); };
        ref.paint = paint;
        paint();
        presetRefs.push(ref);
        return host;
    }
    function rebuildPresets(force) {
        var s = state(), c = colors(), presets = controller.getPresets() || [];
        var isGrid = s.layout !== "list";
        var columns = Math.max(1, Math.min(6, Math.floor((width + 8) / 72)));
        var tileSize = clamp(Math.floor((width - 8 * (columns - 1)) / columns), 55, 86);
        var key = JSON.stringify({ layout: isGrid, size: tileSize, presets: presets });
        if (!force && key === lastPresetKey) {
            for (var p = 0; p < presetRefs.length; p++) presetRefs[p].paint();
            return;
        }
        lastPresetKey = key; presetRefs = [];
        presetLayout.clear();
        if (!presets.length) return;
        if (isGrid) {
            var grid = new ui.FlowLayout(8, 8);
            grid.setMargins(0, 0, 0, 0); grid.setSpaceBetween(8);
            for (var i = 0; i < presets.length; i++) grid.add(presetItem(presets[i], i, tileSize, true, c));
            var host = new ui.Container();
            host.setLayout(grid);
            var height = grid.getHeightForWidth(width);
            if (height > 0) host.setFixedHeight(height);
            presetLayout.add(host);
        } else {
            for (var j = 0; j < presets.length; j++) presetLayout.add(presetItem(presets[j], j, tileSize, false, c));
        }
    }
    function resize(requestedHeight) {
        if (closed || resizing) return;
        resizing = true;
        try {
            var targetHeight = requestedHeight === undefined ? graphHeight : requestedHeight;
            var nextHeight = Math.max(120, isFinite(targetHeight) ? Math.round(targetHeight) : 210);
            var heightChanged = nextHeight !== graphHeight;
            if (heightChanged) {
                graphHeight = nextHeight;
                graphHost.setFixedHeight(graphHeight);
                graph.setSize(width, graphHeight); graph.setMinimumWidth(160);
            }
            var widthChanged = syncCanvasWidths();
            if (!heightChanged && !widthChanged) return;
            refreshPresetHeader();
            if (widthChanged) rebuildPresets(true);
            drawGraph(); drawDivider(false); drawPowerSlider();
        } finally { resizing = false; }
    }
    function refresh() {
        if (closed) return;
        stateSnapshot = controller.getState() || {};
        // Recheck descriptor signatures once per refresh, including callers
        // that update an existing array; pointer-only paints use the snapshot.
        selectionCache.source = null;
        var s = state(), c = colors(), expression = s.expression || "";
        syncing = true;
        try {
            if (input.getText() !== expression) input.setText(expression);
            input.setPlaceholder(s.customMixed ? "Mixed expressions — type to replace selected easing" : s.nativeMagic ? "Native Magic Easing — type to replace" : "Magic expression, e.g. x^3");
            var power = Number(s.power) || 4;
            var powerText = powerSelected() ? String(power) : "";
            if (!powerSelected()) powerEditing = false;
            if (!powerEditing && powerField.getText() !== powerText) powerField.setText(powerText);
        } finally { syncing = false; }
        for (var b = 0; b < buttons.length; b++) buttons[b].setBackgroundColor(c.surface);
        input.setBackgroundColor(c.surface); input.setTextColor(c.text);
        powerField.setBackgroundColor(c.surface); powerLabel.setTextColor(c.text);
        inputField.host.setBackgroundColor(c.surface); numericField.host.setBackgroundColor(c.surface);
        powerField.setTextColor(c.text);
        inputGroup.setBackgroundColor(c.raised); tabGroup.setBackgroundColor(c.raised);
        directionGroup.setBackgroundColor(c.raised); actionGroup.setBackgroundColor(c.raised);
        graphHost.setBackgroundColor(c.bg);
        libraryButton.setBackgroundColor(c.bg);
        var direction = directions.indexOf(s.direction || "out") < 0 ? "out" : (s.direction || "out");
        if (endpointHover && !endpointActive(endpointHover)) endpointHover = null;
        if (endpointDrag && !endpointActive(endpointDrag.side)) endpointDrag = null;
        if (!powerSelected() || direction !== "in out") { guideHover = false; guideDrag = null; }
        if (weightEditor && !weightActive(weightEditor.kind)) weightEditor.dismiss();
        for (var d = 0; d < directionButtons.length; d++) {
            var selectedDirection = powerSelected() && directions[d] === direction;
            directionButtons[d].setText(directionCaptions[d]);
            directionButtons[d].setBackgroundColor(selectedDirection ? c.selected : c.raised);
            directionButtons[d].setToolTip("Preview " + directionCaptions[d] + " Power easing." + (s.applyOnDirection ? " Apply on direction is on." : " Click Apply to update keyframes, or enable Apply on direction in Settings."));
        }
        valueButton.setBackgroundColor(mode() === "value" ? c.selected : c.raised);
        speedButton.setBackgroundColor(mode() === "speed" ? c.selected : c.raised);
        applyButton.setEnabled(s.canApply !== false);
        var needsApply = s.canApplyPower !== false;
        applyPowerButton.setBackgroundColor(needsApply ? c.accent : "#434343");
        applyPowerLabel.setText(!needsApply && (s.selectedPowerLevels || []).length && (powerSelected() || !!s.powerExpression) ? "Applied" : "Apply");
        applyPowerLabel.setTextColor(needsApply ? c.text : c.muted);
        flattenButton.setEnabled(s.canFlatten !== false);
        clearButton.setEnabled(s.canClear !== false);
        presetTitle.setTextColor(c.muted); libraryNameLabel.setTextColor("#ffffff");
        selectedPowerLabel.setTextColor(c.muted);
        var message = s.status || (typeof s.error === "string" ? s.error : "");
        input.setToolTip("Use x from 0 to 1. Sync expression in Settings links this field to the Power controls." + (message ? "\n" + message : ""));
        var graphHelp = "Selected curves are grey; Power is purple. Drag the divider below to resize.";
        if (s.selectionPreviewLimited) graphHelp += "\nShowing the first 10 selected keyframes. Apply, Clear and Flatten use the full selection.";
        if (powerSelected()) {
            graphHelp += "\nDrag horizontal handles toward the centre to adjust endpoint slope; click to enter a weight, or right-click a handle to reset.";
            if (endpointActive("bottom")) graphHelp += " Bottom: " + endpointValue("bottom") + ".";
            if (endpointActive("top")) graphHelp += " Top: " + endpointValue("top") + ".";
        }
        if (powerSelected() && direction === "in out") graphHelp += "\nDrag the vertical line in 1% steps, click to adjust the midpoint, or right-click to reset to 0.5. Current: " + bothMidpoint();
        graphHelp += "\nRight-click an empty area for Reset Weights.";
        graph.setToolTip(graphHelp + (message ? "\n" + message : ""));
        graphHost.setToolTip(graphHelp + (message ? "\n" + message : ""));
        applyPowerButton.setToolTip("Apply the current expression." + (message ? "\n" + message : ""));
        powerSlider.setToolTip("Drag whole-number Power 1 to " + maxPower() + (powerSelected() ? ". Current: " + power : ". Custom expression: no Power setting selected.") + "\nType a precise Power above 12 in the numeric field." + (s.applyOnDrag ? "\nApply on drag is on." : "\nPreview only; click Apply to update keyframes.") + (message ? "\n" + message : ""));
        ui.setBackgroundColor(c.bg);
        var themeKey = c.bg + c.text;
        rebuildPresets(themeKey !== lastThemeKey); lastThemeKey = themeKey;
        syncCanvasWidths();
        refreshPresetHeader();
        drawGraph(); drawDivider(false); drawPowerSlider();
    }
    ui.onResize = function() { resize(); };
    var initial = state();
    graphHeight = Math.max(120, Number(initial.graphHeight) || 210);
    localMode = initial.mode || "value";
    graph.setSize(width, graphHeight);
    graph.setMinimumWidth(160); powerSliderCanvas.setMinimumWidth(0); dividerCanvas.setMinimumWidth(0);
    graphHost.setFixedHeight(graphHeight);
    refresh();
    // Docking can finish laying out children after the root's resize callback.
    // Observe allocation changes without redrawing an unchanged panel.
    var layoutTimer = new api.Timer({onTimeout:function() { resize(); }});
    layoutTimer.setInterval(120); layoutTimer.setRepeating(true); layoutTimer.start();
    return {
        refresh: refresh,
        layoutChanged: function() {
            if (closed) return;
            lastPresetKey = null;
            // Preferences and the active library can change independently of
            // the last snapshot. Refresh obtains one new snapshot and rebuilds
            // the presets and header before using its saved graph height.
            refresh();
            resize(Number(state().graphHeight) || 210);
        },
        resize: resize,
        openWeightEditor: openWeightEditor,
        openMidpointEditor: openMidpointEditor,
        onClose: function() { closed = true; if (weightEditor) weightEditor.dismiss(); drag = null; guideDrag = null; guideHover = false; endpointDrag = null; endpointHover = null; dividerHover = false; sliderDragging = false; presetRefs = []; graphScene = null; selectionCache = {source:null, key:null, curves:[], value:null, speed:null}; functionRefs = []; stateSnapshot = null; compiledCache.clear(); sampleCache.clear(); pathCache.clear(); layoutTimer.stop(); }
    };
}

/* Measey 1.6.3 — preview only the first ten selected keyframes. */
(function () {
    'use strict';
    var VERSION = '1.6.3', PREVIEW_LIMIT = 10, PREF = 'measey.preferences.v1', LIBS = 'measey.libraries.v1';
    var preferences = {defaultsVersion:130,autoApply:false,applyOnDrag:false,applyOnDirection:false,syncExpression:true,powerSelected:true,layout:'grid', graphHeight:235, mode:'value',power:4,bothMidpoint:0.5,bottom:0,top:0,direction:'out',customExpression:'x'};
    var libraries = [], libraryIndex = 0, panel = null, busy = false, closed = false;
    var state = {expression:'x', status:'Select keyframes to preview their outgoing easing.', previewCurves:[], selectionPreviewCurves:[], selectedPowerLevels:[], selectedPreset:null};
    var selection = null, selectionLayers=Object.create(null), selectionIdentity = '', pendingSelection = '', pendingKind = '', draft = false, lastAppliedCustom = null,lastSyncedExpression=null,lastSyncedSelection='';
    // Cache by exact source text, including rejected custom formulas. Selection
    // snapshots stay fresh; only pure expression work survives a reread.
    function boundedCache(limit) {
        var entries=Object.create(null),order=[],characters=0;
        return {
            has:function(key){return Object.prototype.hasOwnProperty.call(entries,key);},
            get:function(key){return entries[key];},
            put:function(key,value){
                if(key.length>262144)return value;
                if(!Object.prototype.hasOwnProperty.call(entries,key)){order.push(key);characters+=key.length;}
                entries[key]=value;
                while(order.length>limit||characters>262144){var old=order.shift();characters-=old.length;delete entries[old];}
                return value;
            }
        };
    }
    var compiledCache=boundedCache(256),detectionCache=boundedCache(256),matchCache=boundedCache(256);
    var generatedKey='',generatedValue='',applySnapshot=null,applyExpression='',applyClear=false,applyNeeded=false;
    function compiledExpression(expression) {
        if(compiledCache.has(expression))return compiledCache.get(expression);
        return compiledCache.put(expression,MeaseyMath.compile(expression));
    }
    function detectedPower(expression) {
        if(detectionCache.has(expression))return detectionCache.get(expression);
        var detected=null;
        if(typeof MeaseyMath.detectPower==='function')try{detected=MeaseyMath.detectPower(expression);}catch(e){}
        return detectionCache.put(expression,detected);
    }
    function safeLoad(key) { try { return api.hasPreferenceObject(key) ? api.getPreferenceObject(key) : null; } catch(e) { return null; } }
    var loaded = safeLoad(PREF);
    if (loaded && typeof loaded === 'object') {
        if (loaded.defaultsVersion === 130 && typeof loaded.autoApply === 'boolean') preferences.autoApply = loaded.autoApply;
        if (loaded.defaultsVersion === 130 && typeof loaded.applyOnDrag === 'boolean') preferences.applyOnDrag = loaded.applyOnDrag;
        if (typeof loaded.applyOnDirection === 'boolean') preferences.applyOnDirection=loaded.applyOnDirection;
        if (typeof loaded.syncExpression === 'boolean') preferences.syncExpression=loaded.syncExpression;
        if (typeof loaded.powerSelected === 'boolean') preferences.powerSelected=loaded.powerSelected;
        if (loaded.layout === 'list' || loaded.layout === 'grid') preferences.layout = loaded.layout;
        if (typeof loaded.graphHeight === 'number' && isFinite(loaded.graphHeight)) preferences.graphHeight = Math.max(120,loaded.graphHeight);
        if (loaded.mode === 'speed') preferences.mode = 'speed';
        if (typeof loaded.power === 'number' && isFinite(loaded.power) && loaded.power>=1) preferences.power=loaded.power;
        if (typeof loaded.bothMidpoint === 'number' && isFinite(loaded.bothMidpoint) && loaded.bothMidpoint>=0.01 && loaded.bothMidpoint<=0.99) preferences.bothMidpoint=loaded.bothMidpoint;
        ['bottom','top'].forEach(function(side){if(typeof loaded[side]==='number'&&isFinite(loaded[side])&&loaded[side]>=0&&loaded[side]<=1)preferences[side]=loaded[side];});
        if (['in','out','in out'].indexOf(loaded.direction)>=0) preferences.direction=loaded.direction;
        if (typeof loaded.customExpression === 'string' && loaded.customExpression.length<=12000) preferences.customExpression=loaded.customExpression;
    }
    function generatedExpression(){
        var key=[preferences.power,preferences.direction,preferences.bothMidpoint,preferences.bottom,preferences.top].join('|');
        if(key!==generatedKey){generatedValue=MeaseyMath.powerExpression(preferences.power,preferences.direction,preferences.bothMidpoint,preferences.bottom,preferences.top);generatedKey=key;}
        return generatedValue;
    }
    function requestedExpression(){return state.powerSelected?generatedExpression():(state.customCurveExpression||'');}
    function recogniseExpression(expression) {
        var check=MeaseyMath.validate(expression,128),detected=null,changes={powerSelected:false};
        state.customCurveExpression=check.ok?check.expression:'';
        if(check.ok)detected=detectedPower(expression);
        if(detected){
            changes.power=detected.power;changes.direction=detected.direction;changes.powerSelected=true;
            if(detected.direction==='in out')changes.bothMidpoint=detected.midpoint===undefined?0.5:detected.midpoint;
            if(detected.direction!=='out')changes.bottom=detected.bottom===undefined?0:detected.bottom;
            if(detected.direction!=='in')changes.top=detected.top===undefined?0:detected.top;
        }
        state.powerSelected=changes.powerSelected;savePrefs(changes);
        return check;
    }
    function syncGeneratedExpression(){
        state.powerSelected=true;savePrefs({powerSelected:true});
        if(!preferences.syncExpression)return;
        state.expression=generatedExpression();state.customCurveExpression=state.expression;state.error=false;state.nativeMagic=false;state.customMixed=false;
        // A generated field update must not be treated as a later typing commit.
        savePrefs({customExpression:state.expression});lastAppliedCustom=state.expression;lastSyncedExpression=state.expression;lastSyncedSelection=selectionToken();
    }
    state.expression=loaded&&typeof loaded.customExpression==='string'?preferences.customExpression:generatedExpression();
    preferences.customExpression=state.expression;state.powerSelected=preferences.powerSelected;
    var initialCheck=MeaseyMath.validate(state.expression,128);state.customCurveExpression=initialCheck.ok?initialCheck.expression:'';
    if(loaded&&typeof loaded.customExpression==='string'&&typeof loaded.powerSelected!=='boolean')recogniseExpression(state.expression);
    state.activeExpression=requestedExpression();state.previewCurves=state.activeExpression?[{expression:state.activeExpression}]:[];
    // Evaluated comparisons recognize equivalent syntax, including x^3 and pow(x,3).
    // Irregular probes avoid the regular-grid aliases common with trigonometry.
    function expressionsMatch(a,b) {
        if(typeof a!=='string'||typeof b!=='string'||!a.trim()||!b.trim())return false;
        if(a===b)return true;
        var key=JSON.stringify(a<b?[a,b]:[b,a]);
        if(matchCache.has(key))return matchCache.get(key);
        try {
            var first=compiledExpression(a),second=compiledExpression(b);
            if(first.expression===second.expression)return matchCache.put(key,true);
            // Include both shortest allowed midpoint branches. One opposite
            // endpoint can be linear while the narrow branch still differs.
            var probes=[0,1,0.00037,0.00157,0.00371,0.00813,0.0157,0.0371,0.0813,0.1297,0.1741,0.2339,0.2917,0.3593,0.4171,0.5,0.5639,0.6293,0.6831,0.7499,0.8173,0.8731,0.9317,0.9739,0.99187,0.99629,0.99843,0.99963];
            for(var i=0;i<probes.length;i++) {
                var x=first(probes[i]),y=second(probes[i]);
                if(!isFinite(x)||!isFinite(y)||Math.abs(x-y)>1e-9*Math.max(1,Math.abs(x),Math.abs(y)))return matchCache.put(key,false);
            }
            return matchCache.put(key,true);
        }catch(e){return matchCache.put(key,false);}
    }
    function powerNeedsApply() {
        if(!selection||!selection.count||!selection.keys||!selection.keys.length)return false;
        var expression=requestedExpression();if(!expression)return false;
        var clearRequested=state.powerSelected&&preferences.power===1;
        if(applySnapshot===selection&&applyExpression===expression&&applyClear===clearRequested)return applyNeeded;
        var silver=MeaseyHost.colors?MeaseyHost.colors.clear:16,plum=MeaseyHost.colors?MeaseyHost.colors.magic:11;
        applyNeeded=selection.keys.some(function(key) {
            var magic=key.magic||{},data=key.data||{};
            if(clearRequested)return !!magic.active||data.colorId!==silver;
            return data.colorId!==plum||!magic.active||data.interpolation===2||!expressionsMatch(magic.expression||'',expression);
        });
        applySnapshot=selection;applyExpression=expression;applyClear=clearRequested;
        return applyNeeded;
    }
    function selectedPower(key) {
        var magic=key.magic||{};
        if(!magic.active)return 1;
        if(!magic.expression||typeof MeaseyMath.detectPower!=='function')return '?';
        var detected=detectedPower(magic.expression);
        return detected&&typeof detected.power==='number'&&isFinite(detected.power)?detected.power:'?';
    }
    function normaliseLibrary(raw) {
        if (!raw || typeof raw.name !== 'string' || !Array.isArray(raw.presets)) return null;
        var result = {name:raw.name.trim().slice(0,60)||'UNTITLED',presets:[]};
        raw.presets.slice(0,500).forEach(function(p,i) {
            if (!p || typeof p.name !== 'string' || typeof p.expression !== 'string') return;
            var check = MeaseyMath.validate(p.expression,96);
            if (!check.ok) return;
            var type=typeof p.type==='string'?p.type.toLowerCase().trim().slice(0,15):'';
            var power=typeof p.power==='number'&&isFinite(p.power)&&p.power>=1&&['in','out','in out'].indexOf(type)>=0?p.power:undefined;
            var midpoint=type==='in out'?(p.bothMidpoint===undefined?0.5:p.bothMidpoint):undefined;
            var bottom=p.bottom===undefined?0:p.bottom,top=p.top===undefined?0:p.top;
            if(type==='in out'&&(typeof midpoint!=='number'||!isFinite(midpoint)||midpoint<0.01||midpoint>0.99))power=undefined;
            if(typeof bottom!=='number'||!isFinite(bottom)||bottom<0||bottom>1||typeof top!=='number'||!isFinite(top)||top<0||top>1)power=undefined;
            if(power!==undefined&&!expressionsMatch(MeaseyMath.powerExpression(power,type,midpoint,bottom,top),check.expression))power=undefined;
            result.presets.push({id:'custom-'+i,name:p.name.toUpperCase().slice(0,40),type:type,expression:check.expression,clear:p.clear===true,power:power,bothMidpoint:power!==undefined&&type==='in out'?midpoint:undefined,bottom:power!==undefined?bottom:undefined,top:power!==undefined?top:undefined});
        });
        return result;
    }
    var savedLibs = safeLoad(LIBS);
    if (savedLibs && Array.isArray(savedLibs.libraries)) savedLibs.libraries.slice(0,50).forEach(function(raw) { var lib=normaliseLibrary(raw); if(lib) libraries.push(lib); });
    if(savedLibs&&typeof savedLibs.activeIndex==='number'&&savedLibs.activeIndex>=0&&savedLibs.activeIndex<libraries.length)libraryIndex=Math.floor(savedLibs.activeIndex);
    if(!libraries.length)libraries.push({name:'MY LIBRARY',presets:[]});
    function savePrefs(change) {
        if(change) Object.keys(change).forEach(function(k) { if(Object.prototype.hasOwnProperty.call(preferences,k)) preferences[k]=change[k]; });
        try { api.setPreferenceObject(PREF,preferences); } catch(e) { console.warn('Measey preferences: '+e); }
    }
    if(!loaded||loaded.defaultsVersion!==130)savePrefs();
    function saveLibraries() { api.setPreferenceObject(LIBS,{libraries:libraries,activeIndex:libraryIndex}); }
    function refresh(layout) { if(panel && !closed) { if(layout) panel.layoutChanged(); else panel.refresh(); } }
    function status(text) { state.status=text; refresh(); }
    function selectionToken() { try { return api.getActiveComp()+'|'+api.getSelectedKeyframeIds().slice().sort().join(','); } catch(e) { return ''; } }
    var debounce = new api.Timer({onTimeout:function() {
        if(closed || busy || !pendingKind || (pendingKind==='custom'&&!preferences.autoApply) || (pendingKind==='power'&&!preferences.applyOnDrag)) return;
        if(pendingSelection !== selectionToken()) { readSelection(); return; }
        if(pendingKind==='power') applyPower(); else apply();
    }});
    debounce.setInterval(300); debounce.setRepeating(false);
    var refreshTimer = new api.Timer({onTimeout:function(){ if(!closed && !busy) readSelection(false,true); }});
    refreshTimer.setInterval(60); refreshTimer.setRepeating(false);
    function stopPending() { debounce.stop(); pendingSelection='';pendingKind=''; }
    function readSelection(loadExpression,preserveDraftPreview) {
        if(busy || closed) return;
        var preview=preserveDraftPreview&&draft&&!loadExpression?{activeExpression:state.activeExpression,previewCurves:state.previewCurves,selectedPreset:state.selectedPreset,mixed:state.mixed,draft:draft}:null;
        if(!preview||pendingKind!=='custom'||pendingSelection!==selectionToken())stopPending();
        busy=true;
        try {
            // The UI samples ordinary expression/Bezier descriptors once per
            // distinct curve. Opaque native easing keeps the host fallback.
            selection = MeaseyHost.readSelection(MeaseyMath,{samples:false,previewLimit:PREVIEW_LIMIT});selectionIdentity=selectionToken();
            selectionLayers=Object.create(null);
            (selection.keys||[]).forEach(function(key){selectionLayers[key.id]=true;if(key.layerId)selectionLayers[key.layerId]=true;});
            if(lastSyncedSelection!==selectionIdentity){lastSyncedExpression=null;lastSyncedSelection='';}
            state.selectionPreviewCurves=(selection.previewCurves||[]).slice(0,PREVIEW_LIMIT);
            state.selectionPreviewLimited=(selection.keys||[]).length>PREVIEW_LIMIT;
            var snapshotPowers=Object.create(null);
            state.selectedPowerLevels=(selection.keys||[]).map(function(key){
                var magic=key.magic||{};
                if(!magic.active)return 1;
                var source=magic.expression||'';
                if(!Object.prototype.hasOwnProperty.call(snapshotPowers,source))snapshotPowers[source]=selectedPower(key);
                return snapshotPowers[source];
            });
            lastAppliedCustom=null;
            if(loadExpression) {state.error=false;state.nativeMagic=false;state.customMixed=!!selection.mixed;}
            if(selection.count) state.previewCurves = state.selectionPreviewCurves;
            state.mixed = !!selection.mixed;
            state.previewLabel = selection.count ? selection.count+' selected keyframe'+(selection.count===1?'':'s') : 'EXPRESSION PREVIEW';
            if(selection.count) {
                state.activeExpression=selection.mixed?'':(selection.expression||'');
                if(loadExpression) {
                    state.expression = selection.mixed ? '' : (selection.expression === '' ? '' : (selection.expression || 'x'));
                    state.nativeMagic=!!(selection.segments && selection.segments.length && selection.segments[0].magic.active && !selection.segments[0].magic.expression);
                    recogniseExpression(state.expression);savePrefs({customExpression:state.expression});lastAppliedCustom=null;lastSyncedExpression=state.expression;lastSyncedSelection=selectionIdentity;
                }
                state.status = selection.mixed ? 'Mixed easing. Type an expression to replace the selection.' : (selection.message || state.previewLabel+' · outgoing easing');
            } else {
                if(loadExpression){state.expression='';state.nativeMagic=false;state.customMixed=false;recogniseExpression('');savePrefs({customExpression:''});}
                state.status = loadExpression?'Select a keyframe to get its expression.':'Select keyframes to apply. Adjust Power or type a custom expression.';
            }
            state.selectedPreset = null;
            var currentPresets = presets();
            if(selection.count&&!selection.mixed) currentPresets.some(function(p) { if(expressionsMatch(p.expression,state.activeExpression)){state.selectedPreset=p.id;return true;}return false; });
            draft = false;
            state.canApply = selection.count > 0;
            state.canClear = selection.count > 0;
            state.canFlatten = (selection.segments || []).some(function(s) { return s.magic && s.magic.active; }) || (selection.keys || []).some(function(k) { return k.magic && k.magic.active; });
        } catch(e) { selection=null;selectionLayers=Object.create(null);state.selectionPreviewCurves=[];state.selectionPreviewLimited=false;state.selectedPowerLevels=[];state.status='Could not read selection: '+String(e); state.canApply=false;state.canFlatten=false;state.canClear=false; }
        finally {busy=false;}
        if(preview){state.activeExpression=preview.activeExpression;state.previewCurves=preview.previewCurves;state.selectedPreset=preview.selectedPreset;state.mixed=preview.mixed;draft=preview.draft;}
        refresh();
    }
    function editExpression(text,committed) {
        if(busy||closed) return;
        if(committed&&selectionIdentity!==selectionToken())readSelection(false,true);
        if(committed && !draft && (text===lastAppliedCustom||(text===lastSyncedExpression&&lastSyncedSelection===selectionToken()))) return;
        lastSyncedExpression=null;lastSyncedSelection='';
        stopPending();
        state.expression=text; state.mixed=false;state.customMixed=false;state.nativeMagic=false; state.selectedPreset=null; draft=true;
        savePrefs({customExpression:text});
        var check=recogniseExpression(text);
        if(!check.ok) { state.activeExpression='';state.previewCurves=[];state.error=true;state.status=check.error; refresh(); return; }
        state.error=false;
        state.activeExpression=check.expression;state.previewCurves=[{expression:check.expression}];
        state.status=preferences.autoApply ? 'Valid expression · applying after typing pauses…' : 'Valid expression · click Apply to update selected keys.';
        refresh();
        if(preferences.autoApply) { pendingSelection=selectionToken();pendingKind='custom'; if(committed) apply(); else debounce.start(); }
    }
    function mutate(action,preserveOnFailure) {
        stopPending(); busy=true;
        var savedDraft={expression:state.expression,activeExpression:state.activeExpression,previewCurves:state.previewCurves,selectedPreset:state.selectedPreset,mixed:state.mixed,draft:draft};
        var result;
        try { result=action(); } catch(e) { result={message:'Measey: '+String(e),changed:0}; }
        finally { busy=false; }
        readSelection();
        if(preserveOnFailure && result && !result.changed) {state.expression=savedDraft.expression;state.activeExpression=savedDraft.activeExpression;state.previewCurves=savedDraft.previewCurves;state.selectedPreset=savedDraft.selectedPreset;state.mixed=savedDraft.mixed;draft=savedDraft.draft;}
        if(result && result.message) status(result.message);
        return result;
    }
    function apply() {
        if(closed||busy)return;
        var check=MeaseyMath.validate(state.expression,128);
        if(!check.ok) { status(check.error);return; }
        var outcome=mutate(function(){return MeaseyHost.apply(check.expression);},true);
        if(outcome&&outcome.changed)lastAppliedCustom=state.expression;
    }
    function applyPower() {
        if(closed||busy)return;
        stopPending();
        // Key data can change without changing the selection or before its refresh timer fires.
        readSelection(false,true);
        var expression=requestedExpression();
        if(!expression){status('Type a valid expression or choose Power controls.');return;}
        if(!selection||!selection.count){state.activeExpression=expression;state.previewCurves=[{expression:expression}];status('Select keyframes to apply Power.');return;}
        if(!powerNeedsApply()){if(expressionsMatch(state.customCurveExpression||'',expression)){draft=false;lastAppliedCustom=state.expression;}status(state.powerSelected&&preferences.power===1?'Selected keyframes already use Clear and Silver.':'Selected keyframes already match this curve.');return;}
        var result=mutate(function(){return state.powerSelected&&preferences.power===1?MeaseyHost.clear():MeaseyHost.apply(expression);},true);
        if(result&&result.changed&&expressionsMatch(state.customCurveExpression||'',expression))lastAppliedCustom=state.expression;
    }
    function setPower(value,committed,source) {
        if(closed||busy)return;
        stopPending();
        value=decimalNumber(value);
        if(!isFinite(value)||value<1){status('Enter a finite Power of 1 or more, using a point or comma for decimals.');return;}
        if(source!=='numeric')value=Math.max(1,Math.min(12,Math.round(value)));
        else {
            var candidate;
            try{candidate=MeaseyMath.validate(MeaseyMath.powerExpression(value,preferences.direction,preferences.bothMidpoint,preferences.bottom,preferences.top),128);}catch(e){candidate={ok:false,error:String(e)};}
            if(!candidate.ok){status(candidate.error);return;}
        }
        savePrefs({power:value});showPower(committed,source==='numeric');
    }
    function decimalNumber(value) {
        if(typeof value==='string'){
            value=value.trim();
            if(!/^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(value))return NaN;
            value=Number(value.replace(',','.'));
        }
        return typeof value==='number'&&isFinite(value)?value:NaN;
    }
    function setBothMidpoint(value,committed,source) {
        if(closed||busy)return;
        stopPending();value=decimalNumber(value);
        if(!isFinite(value)||value<0.01||value>0.99){status('Enter a Both midpoint from 0.01 to 0.99, using a point or comma for decimals.');return;}
        if(source==='drag')value=Math.round(value*100)/100;
        savePrefs({bothMidpoint:value});
        if(preferences.direction==='in out')showPower(committed,source==='numeric');else {
            syncGeneratedExpression();state.activeExpression=generatedExpression();state.previewCurves=[{expression:state.activeExpression}];state.mixed=false;state.selectedPreset=null;draft=false;refresh();
        }
    }
    function openMidpointEditor() {
        openWeightEditor('midpoint');
    }
    function openWeightEditor(kind) {
        if(closed||busy)return;
        if(!state.powerSelected||(kind!=='bottom'&&kind!=='top'&&kind!=='midpoint'))return;
        if(kind==='midpoint'&&preferences.direction!=='in out')return;
        if(kind==='bottom'&&preferences.direction==='out')return;
        if(kind==='top'&&preferences.direction==='in')return;
        if(panel&&typeof panel.openWeightEditor==='function')panel.openWeightEditor(kind);
        else if(kind==='midpoint'&&panel&&typeof panel.openMidpointEditor==='function')panel.openMidpointEditor();
    }
    function resetWeights() {
        if(closed||busy)return;
        stopPending();savePrefs({bottom:0,top:0,bothMidpoint:0.5});showPower(true,true);
    }
    function setEndpoint(side,value,committed,source) {
        if(closed||busy||(side!=='bottom'&&side!=='top'))return;
        stopPending();value=decimalNumber(value);
        if(!isFinite(value)||value<0||value>1){status('Drag the endpoint handle toward the centre to make that end less flat.');return;}
        if(source==='drag')value=Math.round(value*100)/100;
        var changes={};changes[side]=value;savePrefs(changes);
        var active=preferences.direction==='in out'||(side==='bottom'&&preferences.direction==='in')||(side==='top'&&preferences.direction==='out');
        if(active)showPower(committed,source==='numeric');else {
            syncGeneratedExpression();state.activeExpression=generatedExpression();state.previewCurves=[{expression:state.activeExpression}];state.mixed=false;state.selectedPreset=null;draft=false;refresh();
        }
    }
    function setDirection(value) {
        if(closed||busy||['in','out','in out'].indexOf(value)<0)return;
        stopPending();savePrefs({direction:value});showPower(preferences.applyOnDirection,true);
    }
    function showPower(committed,numeric) {
        syncGeneratedExpression();var expression=generatedExpression();
        state.activeExpression=expression;state.previewCurves=[{expression:expression}];state.mixed=false;state.selectedPreset=null;draft=false;
        refresh();
        if(numeric){if(committed)applyPower();return;}
        if(!preferences.applyOnDrag)return;
        if(committed)applyPower();
        else if(powerNeedsApply()){pendingSelection=selectionToken();pendingKind='power';debounce.start();}
    }
    function clear() {
        if(closed||busy)return;
        var result=mutate(function(){return MeaseyHost.clear();});
        if(result&&result.changed){savePrefs({power:1});syncGeneratedExpression();state.activeExpression=generatedExpression();refresh();}
    }
    function flatten() { if(closed||busy)return;mutate(function(){return MeaseyHost.flatten(MeaseyMath);}); }
    function presets() { return libraries[libraryIndex].presets; }
    function selectPreset(id) {
        if(closed||busy)return;
        var p=presets().filter(function(p){return p.id===id;})[0]; if(!p)return;
        stopPending(); state.activeExpression=p.expression; state.mixed=false;state.selectedPreset=id;state.previewCurves=[{expression:p.expression}];draft=false;
        if(typeof p.power==='number'){
            var changes={power:p.power,direction:p.type,bottom:p.bottom===undefined?0:p.bottom,top:p.top===undefined?0:p.top};if(p.type==='in out')changes.bothMidpoint=p.bothMidpoint===undefined?0.5:p.bothMidpoint;savePrefs(changes);
        }
        var separateExpression=state.customCurveExpression;recogniseExpression(p.expression);
        if(preferences.syncExpression||!state.powerSelected){state.expression=p.expression;savePrefs({customExpression:p.expression});state.error=false;state.nativeMagic=false;state.customMixed=false;lastSyncedExpression=state.expression;lastSyncedSelection=selectionToken();}
        else state.customCurveExpression=separateExpression;
        refresh();
        if(p.clear||p.power===1) clear(); else mutate(function(){return MeaseyHost.apply(p.expression);},true);
        state.selectedPreset=id;refresh();
    }
    function deletePreset(id) {
        if(closed||busy)return;
        var lib=libraries[libraryIndex],index=-1;
        lib.presets.some(function(p,i){if(p.id===id){index=i;return true;}return false;});
        if(index<0)return;
        var removed=lib.presets.splice(index,1)[0];
        try{saveLibraries();}catch(e){lib.presets.splice(index,0,removed);status('Delete failed: '+String(e));return;}
        if(state.selectedPreset===id)state.selectedPreset=null;
        refresh(true);status('Deleted '+removed.name+' from '+lib.name+'.');
    }
    function promptName(title,initial) { var name=new ui.Modal().showStringInput(title,'Name',initial||'');return name && name.trim()?name.trim().slice(0,40):null; }
    function newLibrary() { var name=promptName('New Measey Library','UNTITLED');if(!name)return;libraries.push({name:name,presets:[]});libraryIndex=libraries.length-1;saveLibraries();refresh(true); }
    function savePreset() {
        var check=MeaseyMath.validate(requestedExpression()||state.activeExpression||state.expression,128);if(!check.ok){status(check.error);return;}
        var name=promptName('Save Measey Preset','CUSTOM');if(!name)return;
        var lib=libraries[libraryIndex],preset={id:'custom-'+Date.now()+'-'+lib.presets.length,name:name.toUpperCase(),type:'',expression:check.expression};
        if(expressionsMatch(check.expression,generatedExpression())){preset.power=preferences.power;preset.type=preferences.direction;preset.clear=preferences.power===1;preset.bottom=preferences.bottom;preset.top=preferences.top;if(preferences.direction==='in out')preset.bothMidpoint=preferences.bothMidpoint;}
        lib.presets.push(preset);saveLibraries();refresh(true);status('Saved '+name.toUpperCase()+' in '+lib.name+'.');
    }
    function importLibrary() {
        try {
            var path=ui.chooseFileToOpen('','Measey Library (*.json)');if(!path)return;
            if(api.getFileSize && api.getFileSize(path)>2048)throw Error('Library exceeds 2 MB.');
            var raw=JSON.parse(api.readFromFile(path));var array=raw.libraries||[raw];var added=0;
            array.slice(0,50).forEach(function(l){var lib=normaliseLibrary(l);if(lib){libraries.push(lib);added++;}});
            if(!added)throw Error('No usable Measey libraries found.');
            libraryIndex=libraries.length-1;saveLibraries();refresh(true);status('Imported '+added+' librar'+(added===1?'y.':'ies.'));
        }catch(e){status('Import failed: '+e);}
    }
    function exportLibrary() {
        try {var lib=libraries[libraryIndex];var path=ui.chooseFileToSave(lib.name+'.json','Measey Library (*.json)');if(!path)return;if(!api.writeToFile(path,JSON.stringify(lib,null,2),true))throw Error('Could not write library.');status('Library exported.');}catch(e){status('Export failed: '+e);}
    }
    function item(name,fn,enabled){ui.addMenuItem({name:name,onMouseRelease:fn,enabled:enabled!==false});}
    function separator(){item('',function(){});}
    function showLibrarySettings() {
        ui.clearContextMenu();
        item('Save Preset…',savePreset);item('New Library…',newLibrary);item('Import Library…',importLibrary);item('Export Current Library…',exportLibrary);
        separator();item('Library',function(){},false);
        libraries.forEach(function(l,i){item('    '+l.name+(libraryIndex===i?' ✓':''),function(){libraryIndex=i;saveLibraries();refresh(true);});});
        separator();item('Preset layout',function(){},false);
        ['list','grid'].forEach(function(v){item('    '+(v==='list'?'List':'Grid')+(preferences.layout===v?' ✓':''),function(){savePrefs({layout:v});refresh(true);});});
        ui.showContextMenu();
    }
    function showSettings() {
        ui.clearContextMenu();
        item('Apply on type'+(preferences.autoApply?' ✓':''),function(){if(pendingKind==='custom')stopPending();savePrefs({autoApply:!preferences.autoApply});status(preferences.autoApply?'Valid custom edits apply after 300 ms.':'Custom typing is manual. Use custom Apply.');});
        item('Apply on drag'+(preferences.applyOnDrag?' ✓':''),function(){if(pendingKind==='power')stopPending();savePrefs({applyOnDrag:!preferences.applyOnDrag});status(preferences.applyOnDrag?'Power and graph handle dragging apply after 300 ms.':'Dragging previews only. Use Apply or enable Apply on direction.');});
        item('Apply on direction'+(preferences.applyOnDirection?' ✓':''),function(){savePrefs({applyOnDirection:!preferences.applyOnDirection});status(preferences.applyOnDirection?'In, Both and Out apply the curve when clicked.':'In, Both and Out update the preview. Use Apply to update selected keyframes.');});
        item('Sync expression'+(preferences.syncExpression?' ✓':''),function(){savePrefs({syncExpression:!preferences.syncExpression});if(preferences.syncExpression&&state.powerSelected){stopPending();syncGeneratedExpression();draft=false;}refresh();});
        separator();item('Measey Version '+VERSION,function(){},false);
        item('Expression Help',function(){new ui.Modal().showMessage('Measey Expressions\n\nUse normalized x from 0 to 1.\n\npow(x, 3)\n1 - pow(1 - x, 5)\nx < 0.5 ? pow(2*x,4)/2 : 1-pow(2*(1-x),4)/2\n\nThe Power slider ranges from 1 to 12 in whole numbers. Typed Power values can exceed 12 and retain decimals, with either a point or comma, such as 1.539 or 1,539. All automatic Apply options start off. Power 1 clears Magic Easing and sets Silver. Committed numeric entries apply immediately. Direction buttons preview by default; enable Apply on direction to apply when clicked. Apply on drag controls the Power slider and graph handle application; Apply on type controls custom text independently. Bottom and top handles reduce endpoint flatness without moving start/end values. In shows the bottom handle, Out the top, and Both both; they default to flat. Drag toward the centre, click to open its native numeric dialog, or right-click to reset an endpoint. Right-click empty graph space and choose Reset Weights to restore both endpoints and the midpoint together. The Both midpoint ranges from 0.01 to 0.99. Dragging snaps to 0.01; a short click opens a titled native numeric dialog. In and Out keep the remembered Both midpoint without using it. Power Apply is enabled when selected keys need the requested curve.\n\nSync expression copies generated Power, direction, midpoint and endpoint changes into the expression field. Turn it off to keep separate text. Typing or Get Expression recognizes matching Power curves and updates the controls; unrecognized expressions show no selected Power or direction. Power Apply uses the current custom expression when no Power curve is selected. Clear synchronizes to x when enabled; Flatten keeps the source formula as a reference. Library settings manages saved and imported presets; new libraries start empty. Right-click a preset to delete it. Selected curves remain visible as overlays while you edit the current formula.\n\nSupports arithmetic, powers (^), math functions, if(), ternary conditions and var name := …; declarations. Unsupported ExprTk loops/vectors show an error. Flatten fits a Bézier and reports approximation error.');});
        ui.showContextMenu();
    }
    var controller={getState:function(){state.layout=preferences.layout;state.autoApply=preferences.autoApply;state.applyOnDrag=preferences.applyOnDrag;state.applyOnDirection=preferences.applyOnDirection;state.syncExpression=preferences.syncExpression;state.mode=preferences.mode;state.graphHeight=preferences.graphHeight;state.power=preferences.power;state.bothMidpoint=preferences.bothMidpoint;state.bottom=preferences.bottom;state.top=preferences.top;state.powerExpression=requestedExpression();if(!state.powerSelected)state.activeExpression=state.powerExpression;state.maxPower=12;state.canApplyPower=powerNeedsApply();state.direction=preferences.direction;state.libraryName=libraries[libraryIndex].name;return state;},getPresets:presets,editExpression:editExpression,selectPreset:selectPreset,deletePreset:deletePreset,apply:apply,applyPower:applyPower,clear:clear,flatten:flatten,getSelection:function(){readSelection(true);},setPower:setPower,setBothMidpoint:setBothMidpoint,openMidpointEditor:openMidpointEditor,openWeightEditor:openWeightEditor,resetWeights:resetWeights,setEndpoint:setEndpoint,setDirection:setDirection,showSettings:showSettings,showLibrarySettings:showLibrarySettings,savePreferences:savePrefs};
    ui.setTitle('Measey');
    panel=buildMeaseyUI(controller,MeaseyMath);
    ui.addCallbackObject({
        onKeySelectionChanged:function(){if(!busy)readSelection();},
        onCompChanged:function(){if(!busy)readSelection();},
        onSceneChanged:function(){if(!busy)readSelection();},
        onAttrChanged:function(layer,attr){if(busy||MeaseyHost.isBusy()||closed||!selection)return;if(selectionLayers[layer]){refreshTimer.stop();refreshTimer.start();}}
    });
    ui.onClose=function(){closed=true;debounce.stop();refreshTimer.stop();if(panel)panel.onClose();};
    readSelection();ui.show();panel.resize();
})();
