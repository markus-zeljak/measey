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
