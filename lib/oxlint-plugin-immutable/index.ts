/**
 * Oxlint JS plugin for immutable-style code.
 * Oxlint has no `no-restricted-syntax`, so the `let` ban is this small rule.
 */

interface Declaration {
    kind: string;
}

interface RuleContext {
    report(descriptor: { node: Declaration; message: string }): void;
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
                    VariableDeclaration(node: Declaration) {
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
        }
    }
};
