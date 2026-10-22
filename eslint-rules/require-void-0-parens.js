"use strict";

module.exports = {
    meta: {
        type: "suggestion",
        docs: {
            description: "Require parentheses around void 0 expressions.",
        },
        fixable: "code",
        schema: [],
        messages: {
            missingParentheses: "Use (void 0) with parentheses instead of void 0.",
        },
    },
    create(context) {
        const sourceCode = context.getSourceCode();

        return {
            UnaryExpression(node) {
                if (
                    node.operator !== "void" ||
                    node.argument.type !== "Literal" ||
                    node.argument.value !== 0
                ) {
                    return;
                }

                const tokenBefore = sourceCode.getTokenBefore(node);
                const tokenAfter = sourceCode.getTokenAfter(node);
                const hasParentheses =
                    tokenBefore &&
                    tokenAfter &&
                    tokenBefore.value === "(" &&
                    tokenAfter.value === ")";

                if (hasParentheses) {
                    return;
                }

                context.report({
                    node,
                    messageId: "missingParentheses",
                    fix(fixer) {
                        return [
                            fixer.insertTextBefore(node, "("),
                            fixer.insertTextAfter(node, ")"),
                        ];
                    },
                });
            },
        };
    },
};
