import { parse, type AnyNode, type ObjectExpression, type FunctionDeclaration } from "acorn";

type Syntax = AnyNode | null | undefined;
const catalogExport = "exports.ANTIGRAVITY_SESSION_OPTION_CATALOG";
const helperBinding = "agent_choice_cli_apply_1";
const helperCallee = `(0, ${helperBinding}.agentChoiceCliApply)`;

function program(source: string) {
  return parse(source, { ecmaVersion: "latest", sourceType: "script" });
}
// Compare only small relevant AST expressions. Positions, spelling of quotes and
// comments are immaterial; computed properties, operators and bindings are not.
function same(node: Syntax, expression: string): boolean {
  const expected = program(`(${expression});`).body[0];
  const shape = (value: unknown) => JSON.stringify(value, (key, child) =>
    ["start", "end", "raw"].includes(key) ? undefined : child);
  return expected?.type === "ExpressionStatement" && shape(node) === shape(expected.expression);
}
function identifier(node: Syntax, name: string): boolean {
  return node?.type === "Identifier" && node.name === name;
}
function literal(node: Syntax, value: unknown): boolean {
  return node?.type === "Literal" && node.value === value;
}
function properties(node: Syntax): Map<string, AnyNode> | undefined {
  if (node?.type !== "ObjectExpression") return undefined;
  const result = new Map<string, AnyNode>();
  for (const property of node.properties) {
    if (property.type !== "Property" || property.computed || property.method || property.kind !== "init") return undefined;
    const key = property.key.type === "Identifier" ? property.key.name :
      property.key.type === "Literal" && typeof property.key.value === "string" ? property.key.value : undefined;
    if (key === undefined || result.has(key) || key === "__proto__") return undefined;
    result.set(key, property.value);
  }
  return result;
}
function helperCall(node: Syntax): boolean {
  if (node?.type !== "CallExpression" || node.optional ||
      !(same(node.callee, helperCallee) || same(node.callee, `${helperBinding}.agentChoiceCliApply`)) ||
      node.arguments.length !== 3 || !literal(node.arguments[0], "antigravity")) return false;
  const forms = node.arguments[1];
  const emitted = node.arguments[2];
  if (forms?.type !== "ArrayExpression" || forms.elements.length !== 1 ||
      emitted?.type !== "Literal" || typeof emitted.value !== "string") return false;
  const form = properties(forms.elements[0]);
  return !!form && form.size === 3 && literal(form.get("kind"), "value") &&
    same(form.get("names"), JSON.stringify([emitted.value])) &&
    literal(form.get("lift"), "separate-and-long-equals");
}
// Ignore unrelated metadata/function bodies, but never ignore code that executes
// while constructing a catalog: only literal data and the verified helper call.
function staticValue(node: Syntax, allowHelper = false): boolean {
  if (!node) return false;
  if (["Literal", "ArrowFunctionExpression", "FunctionExpression"].includes(node.type)) return true;
  if (node.type === "ArrayExpression") return node.elements.every(element => staticValue(element, allowHelper));
  if (node.type === "CallExpression") return allowHelper && helperCall(node);
  if (node.type !== "ObjectExpression") return false;
  const ordinary: ObjectExpression = { ...node, properties: node.properties.filter(property => property.type !== "SpreadElement") };
  const values = properties(ordinary);
  return !!values && [...values.values()].every(value => staticValue(value, allowHelper)) &&
    node.properties.every(property => property.type !== "SpreadElement" || (allowHelper && helperCall(property.argument)));
}
function boilerplate(node: AnyNode): boolean {
  return node.type === "ExpressionStatement" &&
    (literal(node.expression, "use strict") || same(node.expression, 'Object.defineProperty(exports, "__esModule", {value:true})'));
}
function assignment(node: AnyNode, target: string): Syntax {
  return node.type === "ExpressionStatement" && node.expression.type === "AssignmentExpression" &&
    node.expression.operator === "=" && same(node.expression.left, target) ? node.expression.right : undefined;
}

function verifiedHelper(source: string): boolean {
  let implementation: FunctionDeclaration | undefined;
  let exported = false;
  const declarations = new Set<string>();
  for (const statement of program(source).body) {
    if (boilerplate(statement)) continue;
    if (statement.type === "FunctionDeclaration" && statement.id &&
        ["agentChoiceCliApply", "agentChoiceConfigValue"].includes(statement.id.name)) {
      if (declarations.has(statement.id.name)) return false;
      declarations.add(statement.id.name);
      if (statement.id.name === "agentChoiceCliApply") implementation = statement;
      continue;
    }
    if (statement.type === "VariableDeclaration" && statement.kind === "const" && statement.declarations.length === 1) {
      const entry = statement.declarations[0]!;
      if (!identifier(entry.id, "agent_session_option_agent_args_1") ||
          !same(entry.init, 'require("./agent-session-option-agent-args")') || declarations.has("args")) return false;
      declarations.add("args");
      continue;
    }
    const choiceExport = assignment(statement, "exports.agentChoiceCliApply");
    if (choiceExport && identifier(choiceExport, "agentChoiceCliApply") && !exported) { exported = true; continue; }
    if (identifier(assignment(statement, "exports.agentChoiceConfigValue"), "agentChoiceConfigValue") && !declarations.has("configExport")) {
      declarations.add("configExport"); continue;
    }
    return false;
  }
  if (!implementation || !exported ||
      (declarations.has("configExport") && !declarations.has("agentChoiceConfigValue")) ||
      implementation.async || implementation.generator ||
      implementation.params.length !== 3 || !implementation.params.every((param, index) =>
        identifier(param, ["agent", "forms", "emitted"][index]!))) return false;
  const statements = implementation.body.body;
  if (statements.length !== 2) return false;
  const encoder = statements[0];
  if (encoder?.type !== "VariableDeclaration" || encoder.kind !== "const" || encoder.declarations.length !== 1 ||
      !identifier(encoder.declarations[0]?.id, "encoder") ||
      !same(encoder.declarations[0]?.init, "forms.find((form) => form.names.includes(emitted)) ?? forms[0]")) return false;
  const returned = statements[1];
  const fields = returned?.type === "ReturnStatement" ? properties(returned.argument) : undefined;
  const launch = fields?.get("launchArgs");
  if (launch?.type !== "ArrowFunctionExpression" || launch.async || launch.params.length !== 1 ||
      !identifier(launch.params[0], "value")) return false;
  // The validated value-form encoder selects the non-config branch. Changes to
  // the unused config branch cannot affect this effort mapping.
  const body = launch.body;
  const valueMapping = body.type === "ConditionalExpression" && same(body.test, "encoder.kind === 'config'")
    ? body.alternate : body;
  return !!fields && identifier(fields.get("cli"), "forms") &&
    same(valueMapping, "[emitted, String(value)]") &&
    [...fields].every(([key, value]) => ["cli", "launchArgs"].includes(key) ||
      (key === "removeAgentArgs" && ["ArrowFunctionExpression", "FunctionExpression"].includes(value.type)));
}

/** Read static declarations only. No app modules or discovered code are executed.
 * Validate the binding/export envelope so relevant values cannot be overwritten
 * or hidden in unrelated declarations; inspect only the mapping AST inside it.
 */
export function explicitEffortContract(source: string, helper?: string): { efforts: string[]; helper: boolean } | undefined {
  try {
    let effort: AnyNode | undefined;
    let catalog: AnyNode | undefined;
    let imported = false;
    let importedBeforeEffort = false;
    let initialized = false;
    for (const statement of program(source).body) {
      if (catalog) return undefined; // Reject later mutation or replacement.
      if (boilerplate(statement)) continue;
      if (statement.type === "VariableDeclaration" && statement.kind === "const" && statement.declarations.length === 1) {
        const entry = statement.declarations[0]!;
        if (identifier(entry.id, "ANTIGRAVITY_EFFORT") && entry.init && !effort) {
          effort = entry.init; importedBeforeEffort = imported; continue;
        }
        if (identifier(entry.id, helperBinding) && !imported && same(entry.init, 'require("./agent-choice-cli-apply")')) {
          imported = true; continue;
        }
        return undefined;
      }
      const value = assignment(statement, catalogExport);
      if (value && same(value, "void 0") && !initialized && !effort) { initialized = true; continue; }
      if (value?.type === "ObjectExpression" && effort) { catalog = value; continue; }
      return undefined;
    }
    const options = properties(catalog);
    const fields = properties(effort);
    if (!options || !fields || !literal(options.get("supportsWorkerLaunchPreferences"), true) ||
        !same(options.get("unknownModelOptions"), "[ANTIGRAVITY_EFFORT]")) return undefined;
    if (fields.has("id") && !literal(fields.get("id"), "effort")) return undefined;
    const kind = properties(fields.get("kind"));
    const choices = kind?.get("choices");
    if (!kind || !literal(kind.get("type"), "select") || choices?.type !== "ArrayExpression") return undefined;
    const efforts: string[] = [];
    for (const choice of choices.elements) {
      const value = properties(choice)?.get("value");
      if (value?.type !== "Literal" || typeof value.value !== "string" ||
          !["low", "medium", "high"].includes(value.value) || efforts.includes(value.value)) return undefined;
      efforts.push(value.value);
    }
    if (efforts.length === 0) return undefined;
    const apply = fields.get("apply");
    if (apply?.type !== "ObjectExpression") return undefined;
    const spreads = apply.properties.filter(property => property.type === "SpreadElement");
    const direct = properties({...apply, properties: apply.properties.filter(property => property.type !== "SpreadElement")});
    if (!direct) return undefined;
    const usesHelper = spreads.length === 1;
    if (usesHelper) {
      const call = spreads[0]!.argument;
      if (!importedBeforeEffort || helper === undefined || !verifiedHelper(helper) || !helperCall(call) ||
          call.type !== "CallExpression" || !literal(call.arguments[0], "antigravity") || !literal(call.arguments[2], "--effort") ||
          direct.has("launchArgs") || direct.has("cli")) return undefined;
    } else if (spreads.length || !same(direct.get("launchArgs"), "(value) => ['--effort', String(value)]")) return undefined;
    if (![...direct].every(([key, value]) => key === "launchArgs" || staticValue(value))) return undefined;
    if (![...fields].every(([key, value]) => key === "apply" || staticValue(value, importedBeforeEffort)) ||
        ![...options].every(([key, value]) => key === "unknownModelOptions" || staticValue(value, imported))) return undefined;
    // Other helper invocations (e.g. modelApply) also need the same verified binding.
    if (imported && (helper === undefined || !verifiedHelper(helper))) return undefined;
    return {efforts, helper: usesHelper || imported};
  } catch { return undefined; }
}
