/**
 * Oxlint JS plugin for irodr's functional, immutable style (docs/architecture.md).
 * Oxlint has no `no-restricted-syntax`, so these bans are small rules.
 */

interface Node {
    type: string;
}

interface VariableDeclaration extends Node {
    kind: string;
}

interface ClassNode extends Node {
    superClass: (Node & { name?: string }) | null;
}

interface RuleContext {
    report(descriptor: { node: Node; message: string }): void;
}

/** Errors stay classes: `instanceof` checks and stack traces need them. */
function extendsError(node: ClassNode): boolean {
    return node.superClass?.type === "Identifier" && (node.superClass.name ?? "").endsWith("Error");
}

export default {
    meta: { name: "immutable" },
    rules: {
        "no-let": {
            meta: {
                type: "suggestion",
                docs: { description: "Disallow `let`: use `const` and derive new values instead of reassigning." }
            },
            create(context: RuleContext) {
                return {
                    VariableDeclaration(node: VariableDeclaration) {
                        if (node.kind === "let") {
                            context.report({
                                node,
                                message:
                                    "Use `const`. Derive a new value (map, filter, reduce, a helper function) instead of reassigning."
                            });
                        }
                    }
                };
            }
        },
        "no-class": {
            meta: {
                type: "suggestion",
                docs: { description: "Disallow classes except errors: use factory functions and immutable state." }
            },
            create(context: RuleContext) {
                const check = (node: ClassNode) => {
                    if (!extendsError(node)) {
                        context.report({
                            node,
                            message:
                                "Use a factory function (`createX(options)`) with state in a store instead of a class. Only errors may be classes."
                        });
                    }
                };
                return { ClassDeclaration: check, ClassExpression: check };
            }
        }
    }
};
