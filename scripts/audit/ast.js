const acorn = require("acorn");

/**
 * Source types understood by the audit.
 *
 * "script" -> classic script, sloppy mode allowed, top-level `return` allowed.
 * "module" -> ES module, always strict, top-level `return` forbidden.
 *
 * The distinction matters: the same source text can be valid in one and invalid in the other,
 * so the audit must know which one applies before it parses anything.
 */
const SCRIPT = "script";
const MODULE = "module";

const LEXICAL_KINDS = new Set(["let", "const", "class"]);
const VAR_KINDS = new Set(["var", "function"]);

function parseJs(code, sourceType) {
  const options = { ecmaVersion: "latest", locations: true, allowHashBang: true, sourceType };
  if (sourceType === SCRIPT) {
    // Top-level `return` is legal in a classic script but a SyntaxError in a module.
    options.allowReturnOutsideFunction = true;
  }
  return acorn.parse(code, options);
}

function createScope(type, parent) {
  return { type, parent, bindings: new Map() };
}

function declareBinding(scope, name, kind, node) {
  if (!name || !scope) return null;
  let binding = scope.bindings.get(name);
  if (!binding) {
    binding = { name, kind, decls: [] };
    scope.bindings.set(name, binding);
  }
  binding.decls.push({
    kind,
    line: node && node.loc ? node.loc.start.line : 0,
    column: node && node.loc ? node.loc.start.column : 0,
    start: node && typeof node.start === "number" ? node.start : 0,
  });
  return binding;
}

/** Nearest scope that owns `var` and function declarations. */
function varScopeOf(scope) {
  let current = scope;
  while (current && current.type !== "program" && current.type !== "module" && current.type !== "function") {
    current = current.parent;
  }
  return current || scope;
}

function addRef(state, scope, node, options = {}) {
  state.refs.push({
    name: node.name,
    scope,
    line: node.loc ? node.loc.start.line : 0,
    column: node.loc ? node.loc.start.column : 0,
    start: typeof node.start === "number" ? node.start : 0,
    guarded: Boolean(options.guarded),
    write: Boolean(options.write),
    binding: null,
  });
}

function lookup(scope, name) {
  let current = scope;
  while (current) {
    const binding = current.bindings.get(name);
    if (binding) return binding;
    current = current.parent;
  }
  return null;
}

/**
 * A reference only participates in temporal-dead-zone errors when it is evaluated while the
 * surrounding script body runs.
 *
 * References inside a function body are treated as "not immediate", because the function may
 * be called long after the declaration was evaluated. This is deliberately conservative: it
 * can miss a real error, but it never invents one.
 */
function isImmediatelyExecuted(ref) {
  let current = ref.scope;
  while (current) {
    if (current.type === "function" || current.type === "class-body") return false;
    if (current.type === "program" || current.type === "module" || current.type === "global") return true;
    current = current.parent;
  }
  return true;
}

function analyzeProgram(ast, sourceType) {
  const globalScope = createScope("global", null);
  const programScope = createScope(sourceType === MODULE ? "module" : "program", globalScope);
  const state = { sourceType, globalScope, programScope, refs: [], imports: [] };
  for (const statement of ast.body) visit(statement, programScope, state);
  return state;
}

/* ------------------------------------------------------------------ *
 * Binding patterns
 * ------------------------------------------------------------------ */

/**
 * Declares every name bound by a binding pattern.
 *
 * `declScope` receives the bindings, `visitScope` is used to evaluate default value
 * expressions (which may reference bindings declared earlier in the same pattern).
 */
function declarePattern(pattern, declScope, kind, visitScope, state) {
  if (!pattern) return;
  switch (pattern.type) {
    case "Identifier":
      declareBinding(declScope, pattern.name, kind, pattern);
      return;
    case "ObjectPattern":
      for (const property of pattern.properties) {
        if (property.type === "RestElement") {
          declarePattern(property.argument, declScope, kind, visitScope, state);
        } else {
          declarePattern(property.value, declScope, kind, visitScope, state);
        }
      }
      return;
    case "ArrayPattern":
      for (const element of pattern.elements) {
        if (element) declarePattern(element, declScope, kind, visitScope, state);
      }
      return;
    case "AssignmentPattern":
      declarePattern(pattern.left, declScope, kind, visitScope, state);
      if (pattern.right) visit(pattern.right, visitScope, state);
      return;
    case "RestElement":
      declarePattern(pattern.argument, declScope, kind, visitScope, state);
      return;
    default:
      visit(pattern, visitScope, state);
  }
}

/** Visits an assignment target: identifiers are references, not bindings. */
function visitAssignmentTarget(node, scope, state) {
  if (!node) return;
  switch (node.type) {
    case "Identifier":
      addRef(state, scope, node, { write: true });
      return;
    case "MemberExpression":
      visit(node.object, scope, state);
      if (node.computed) visit(node.property, scope, state);
      return;
    case "ObjectPattern":
      for (const property of node.properties) {
        if (property.type === "RestElement") visitAssignmentTarget(property.argument, scope, state);
        else visitAssignmentTarget(property.value, scope, state);
      }
      return;
    case "ArrayPattern":
      for (const element of node.elements) {
        if (element) visitAssignmentTarget(element, scope, state);
      }
      return;
    case "AssignmentPattern":
      visitAssignmentTarget(node.left, scope, state);
      visit(node.right, scope, state);
      return;
    case "RestElement":
      visitAssignmentTarget(node.argument, scope, state);
      return;
    default:
      visit(node, scope, state);
  }
}

/* ------------------------------------------------------------------ *
 * Visitors
 * ------------------------------------------------------------------ */

function visitFunction(node, scope, state) {
  const functionScope = createScope("function", scope);
  if (node.type === "FunctionExpression" && node.id) {
    declareBinding(functionScope, node.id.name, "function-expression", node.id);
  }
  for (const parameter of node.params) {
    declarePattern(parameter, functionScope, "param", functionScope, state);
  }
  visit(node.body, functionScope, state);
}

function visitClass(node, scope, state) {
  if (node.superClass) visit(node.superClass, scope, state);
  const classScope = createScope("class-body", scope);
  if (node.id) declareBinding(classScope, node.id.name, "class-expression", node.id);
  for (const member of node.body.body) visit(member, classScope, state);
}

function visitBlock(body, scope, state) {
  const blockScope = createScope("block", scope);
  for (const statement of body) visit(statement, blockScope, state);
}

function visit(node, scope, state) {
  if (!node || typeof node !== "object") return;

  switch (node.type) {
    /* --- expressions that never introduce a binding --- */
    case "Identifier":
      addRef(state, scope, node);
      return;
    case "Literal":
    case "ThisExpression":
    case "Super":
    case "MetaProperty":
    case "PrivateIdentifier":
      return;

    case "TemplateLiteral":
      for (const expression of node.expressions) visit(expression, scope, state);
      return;

    case "TaggedTemplateExpression":
      visit(node.tag, scope, state);
      visit(node.quasi, scope, state);
      return;

    case "MemberExpression":
      visit(node.object, scope, state);
      if (node.computed) visit(node.property, scope, state);
      return;

    case "Property":
      if (node.computed) visit(node.key, scope, state);
      visit(node.value, scope, state);
      return;

    case "ObjectExpression":
      for (const property of node.properties) visit(property, scope, state);
      return;

    case "ArrayExpression":
      for (const element of node.elements) {
        if (element) visit(element, scope, state);
      }
      return;

    case "SpreadElement":
    case "RestElement":
      visit(node.argument, scope, state);
      return;

    case "AssignmentPattern":
      visit(node.right, scope, state);
      visitAssignmentTarget(node.left, scope, state);
      return;

    case "ArrayPattern":
      for (const element of node.elements) {
        if (element) visitAssignmentTarget(element, scope, state);
      }
      return;

    case "ObjectPattern":
      for (const property of node.properties) {
        if (property.type === "RestElement") visitAssignmentTarget(property.argument, scope, state);
        else visitAssignmentTarget(property.value, scope, state);
      }
      return;

    case "AssignmentExpression":
      visitAssignmentTarget(node.left, scope, state);
      visit(node.right, scope, state);
      return;

    case "UpdateExpression":
      visit(node.argument, scope, state);
      return;

    case "UnaryExpression":
      // `typeof x` never throws for an undeclared name, so those references are guarded.
      if (node.operator === "typeof" && node.argument && node.argument.type === "Identifier") {
        addRef(state, scope, node.argument, { guarded: true });
        return;
      }
      visit(node.argument, scope, state);
      return;

    case "AwaitExpression":
    case "ChainExpression":
      visit(node.expression, scope, state);
      return;

    case "BinaryExpression":
    case "LogicalExpression":
      visit(node.left, scope, state);
      visit(node.right, scope, state);
      return;

    case "ConditionalExpression":
      visit(node.test, scope, state);
      visit(node.consequent, scope, state);
      visit(node.alternate, scope, state);
      return;

    case "SequenceExpression":
      for (const expression of node.expressions) visit(expression, scope, state);
      return;

    case "NewExpression":
    case "CallExpression":
      visit(node.callee, scope, state);
      for (const argument of node.arguments) visit(argument, scope, state);
      return;

    case "ImportExpression":
      visit(node.source, scope, state);
      return;

    /* --- declarations --- */
    case "FunctionDeclaration":
      declareBinding(scope, node.id ? node.id.name : null, "function", node);
      visitFunction(node, scope, state);
      return;

    case "FunctionExpression":
      visitFunction(node, scope, state);
      return;

    case "ArrowFunctionExpression":
      visitFunction(node, scope, state);
      return;

    case "ClassDeclaration":
      declareBinding(scope, node.id ? node.id.name : null, "class", node);
      visitClass(node, scope, state);
      return;

    case "ClassExpression":
      visitClass(node, scope, state);
      return;

    case "StaticBlock": {
      const staticScope = createScope("function", scope);
      for (const statement of node.body) visit(statement, staticScope, state);
      return;
    }

    case "VariableDeclaration":
      for (const declarator of node.declarations) {
        const target = node.kind === "var" ? varScopeOf(scope) : scope;
        declarePattern(declarator.id, target, node.kind, scope, state);
        if (declarator.init) visit(declarator.init, scope, state);
      }
      return;

    case "ImportDeclaration": {
      const specifiers = [];
      for (const specifier of node.specifiers) {
        declareBinding(scope, specifier.local.name, "import", specifier);
        specifiers.push({ local: specifier.local.name, imported: specifier.imported ? specifier.imported.name : null, kind: specifier.type });
      }
      state.imports.push({
        source: node.source.value,
        line: node.loc ? node.loc.start.line : 0,
        column: node.loc ? node.loc.start.column : 0,
        specifiers,
        kind: "import",
      });
      return;
    }

    case "ExportNamedDeclaration":
      if (node.source) {
        state.imports.push({
          source: node.source.value,
          line: node.loc ? node.loc.start.line : 0,
          column: node.loc ? node.loc.start.column : 0,
          specifiers: [],
          kind: "re-export",
        });
      }
      if (node.declaration) visit(node.declaration, scope, state);
      return;

    case "ExportDefaultDeclaration":
      if (node.declaration) visit(node.declaration, scope, state);
      return;

    case "ExportAllDeclaration":
      if (node.source) {
        state.imports.push({
          source: node.source.value,
          line: node.loc ? node.loc.start.line : 0,
          column: node.loc ? node.loc.start.column : 0,
          specifiers: [],
          kind: "re-export",
        });
      }
      return;

    /* --- statements --- */
    case "BlockStatement":
      visitBlock(node.body, scope, state);
      return;

    case "ExpressionStatement":
      visit(node.expression, scope, state);
      return;

    case "EmptyStatement":
    case "DebuggerStatement":
      return;

    case "ReturnStatement":
    case "ThrowStatement":
      visit(node.argument, scope, state);
      return;

    case "LabeledStatement":
      visit(node.body, scope, state);
      return;

    case "BreakStatement":
    case "ContinueStatement":
      return;

    case "IfStatement":
      visit(node.test, scope, state);
      visit(node.consequent, scope, state);
      if (node.alternate) visit(node.alternate, scope, state);
      return;

    case "WhileStatement":
      visit(node.test, scope, state);
      visit(node.body, scope, state);
      return;

    case "DoWhileStatement":
      visit(node.body, scope, state);
      visit(node.test, scope, state);
      return;

    case "ForStatement": {
      const forScope = createScope("block", scope);
      if (node.init) visit(node.init, forScope, state);
      if (node.test) visit(node.test, forScope, state);
      if (node.update) visit(node.update, forScope, state);
      visit(node.body, forScope, state);
      return;
    }

    case "ForInStatement":
    case "ForOfStatement": {
      const forScope = createScope("block", scope);
      if (node.left.type === "VariableDeclaration") visit(node.left, forScope, state);
      else visitAssignmentTarget(node.left, forScope, state);
      visit(node.right, scope, state);
      visit(node.body, forScope, state);
      return;
    }

    case "SwitchStatement": {
      visit(node.discriminant, scope, state);
      const switchScope = createScope("block", scope);
      for (const switchCase of node.cases) {
        if (switchCase.test) visit(switchCase.test, switchScope, state);
        for (const statement of switchCase.consequent) visit(statement, switchScope, state);
      }
      return;
    }

    case "TryStatement":
      visitBlock(node.block.body, scope, state);
      if (node.handler) visit(node.handler, scope, state);
      if (node.finalizer) visitBlock(node.finalizer.body, scope, state);
      return;

    case "CatchClause": {
      const catchScope = createScope("catch", scope);
      if (node.param) declarePattern(node.param, catchScope, "catch", catchScope, state);
      visitBlock(node.body.body, catchScope, state);
      return;
    }

    case "WithStatement":
      visit(node.object, scope, state);
      visit(node.body, scope, state);
      return;

    default: {
      for (const key of Object.keys(node)) {
        if (key === "type" || key === "start" || key === "end" || key === "loc" || key === "range") continue;
        const value = node[key];
        if (Array.isArray(value)) {
          for (const item of value) {
            if (item && typeof item === "object" && typeof item.type === "string") visit(item, scope, state);
          }
        } else if (value && typeof value === "object" && typeof value.type === "string") {
          visit(value, scope, state);
        }
      }
      return;
    }
  }
}

/**
 * Analyses a parsed program.
 *
 * Returns the program scope (top-level bindings), every identifier reference with the scope
 * it was written in, and the static import edges of the module.
 */
function analyzeAst(ast, sourceType) {
  const state = analyzeProgram(ast, sourceType);
  for (const ref of state.refs) {
    ref.binding = lookup(ref.scope, ref.name);
  }
  return state;
}

module.exports = {
  SCRIPT,
  MODULE,
  LEXICAL_KINDS,
  VAR_KINDS,
  parseJs,
  analyzeAst,
  createScope,
  declareBinding,
  lookup,
  isImmediatelyExecuted,
  varScopeOf,
};
