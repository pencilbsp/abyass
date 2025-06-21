import { parse } from "acorn";
import * as walk from "acorn-walk";
import { generate } from "astring";
import { Script, createContext, type Context } from "vm";

import type { VideoObject } from "./video";
import { CustomBase64 } from "./custom-base64";

/**
 * Extracts the player configuration object passed to window.SoTrym('player').setup(...)
 * from a deobfuscated script string.
 */
export function extractPlayerConfig(script: string): VideoObject {
  // Parse to AST
  const ast = parse(script, { ecmaVersion: "latest", sourceType: "script" });

  // Map variable name -> VariableDeclarator node
  const varDecls = new Map<string, any>();
  walk.simple(ast, {
    VariableDeclarator(node: any) {
      if (node.id.type === "Identifier") {
        varDecls.set(node.id.name, node);
      }
    },
  });

  // Find setup call: window.SoTrym('player').setup(...)
  let setupCall: any = null;
  walk.simple(ast, {
    CallExpression(node: any) {
      const c = node.callee;
      if (
        c.type === "MemberExpression" &&
        c.property.type === "Identifier" &&
        c.property.name === "setup" &&
        c.object.type === "CallExpression" &&
        c.object.callee.type === "MemberExpression" &&
        c.object.callee.object.type === "Identifier" &&
        c.object.callee.object.name === "window" &&
        c.object.callee.property.type === "Identifier" &&
        c.object.callee.property.name === "SoTrym"
      ) {
        setupCall = node;
      }
    },
  });
  if (!setupCall) throw new Error("window.SoTrym().setup call not found");

  const argNode = setupCall.arguments[0];
  if (!argNode) throw new Error("No argument passed to setup()");

  // Collect dependencies for the argument variable
  const needed = new Set<string>();
  if (argNode.type === "Identifier") {
    const toVisit = [argNode.name];
    while (toVisit.length) {
      const name = toVisit.shift()!;
      if (needed.has(name)) continue;
      const decl = varDecls.get(name);
      if (!decl || !decl.init) continue;
      needed.add(name);
      // walk its init to find nested identifiers
      walk.simple(decl.init, {
        Identifier(id: any) {
          if (!needed.has(id.name) && varDecls.has(id.name)) {
            toVisit.push(id.name);
          }
        },
      });
    }
  }

  // Reconstruct code: declare each needed variable in dependency order
  let codeBlock = "";
  // Order declarations by position in source
  const declNames = Array.from(needed);
  declNames.sort((a, b) => {
    const da = varDecls.get(a);
    const db = varDecls.get(b);
    return (da.start || 0) - (db.start || 0);
  });
  for (const name of declNames) {
    const decl = varDecls.get(name);
    if (!decl.init) continue;
    // generate a declaration statement
    codeBlock += `var ${name} = ${generate(decl.init)};`;
  }
  // Finally assign result
  const resultExpr = argNode.type === "Identifier" ? argNode.name : generate(argNode);
  codeBlock += `result = ${resultExpr};`;

  // Execute in sandbox

  const sandbox: Context = {
    result: undefined,
    JSON,
    window: {
      atob: (s: string) => CustomBase64.decode(s),
    },
  };
  const context = createContext(sandbox);
  new Script(codeBlock).runInContext(context);

  return sandbox.result;
}
