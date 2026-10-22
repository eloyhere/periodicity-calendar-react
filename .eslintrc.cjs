module.exports = {
    root: true,
    env: {
        browser: true,
        es2020: true,
        node: true,
    },
    extends: [
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended",
        "plugin:react-hooks/recommended",
    ],
    ignorePatterns: ["dist", "dist-electron", "release", "eslint-rules", ".eslintrc.cjs"],
    parser: "@typescript-eslint/parser",
    parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        project: ["./tsconfig.json", "./tsconfig.node.json"],
        tsconfigRootDir: __dirname,
    },
    plugins: ["react-refresh", "jsdoc"],
    settings: {
        jsdoc: {
            mode: "typescript",
            tagNamePreference: {
                returns: "return",
            },
        },
    },
    rules: {
        // 1. 控制语句必须使用大括号，箭头函数必须使用块体。
        curly: ["error", "all"],
        "arrow-body-style": ["error", "always"],

        // 2. 禁止直接使用 undefined，统一使用带括号的 (void 0)。
        "no-restricted-globals": [
            "error",
            {
                name: "undefined",
                message: "Use (void 0) instead of undefined.",
            },
        ],
        "require-void-0-parens": "error",

        // 3. 语句末尾必须带分号。
        semi: ["error", "always"],

        // 4. 优先双引号，必要时才用单引号；拼接和类型转换使用模板字符串。
        quotes: [
            "error",
            "double",
            {
                avoidEscape: true,
                allowTemplateLiterals: false,
            },
        ],
        "jsx-quotes": ["error", "prefer-double"],
        "prefer-template": "error",
        "@typescript-eslint/restrict-template-expressions": [
            "error",
            {
                allowAny: false,
                allowBoolean: false,
                allowNullish: false,
                allowNumber: false,
                allowRegExp: false,
                allowNever: false,
            },
        ],

        // 5. 4 空格缩进，禁止制表符。
        indent: ["error", 4, { SwitchCase: 1 }],
        "no-tabs": "error",

        // 6. 变量声明（含解构）必须显式标注类型。
        "@typescript-eslint/typedef": [
            "error",
            {
                variableDeclaration: true,
                arrayDestructuring: true,
                objectDestructuring: true,
                variableDeclarationIgnoreFunction: false,
            },
        ],
        // typedef 与 no-inferrable-types 冲突，必须关闭后者。
        "@typescript-eslint/no-inferrable-types": "off",

        // JSDoc 注释格式：/** 开头，每行 * 前缀，标签和描述完整。
        // 示例中的 */ 与 /** 左对齐，因此不启用 check-alignment。
        "jsdoc/check-indentation": "error",
        "jsdoc/check-syntax": "error",
        "jsdoc/check-tag-names": "error",
        "jsdoc/require-asterisk-prefix": "error",
        "jsdoc/require-description": ["error", { contexts: ["any"] }],
        "jsdoc/require-param-description": "error",
        "jsdoc/require-returns-description": "error",
        "jsdoc/tag-lines": ["error", "never"],

        "react-refresh/only-export-components": [
            "warn",
            { allowConstantExport: true },
        ],
    },
};
