import * as vs from "vscode";
import * as ts from "typescript";
import * as utils from "./utilities";

import { LanguageServiceHost } from "./languageServiceHost";
import { Range } from "vscode";

function includeTypes() {
    return vs.workspace.getConfiguration().get("docthis.includeTypes", true);
}

export class Documenter implements vs.Disposable {
    private _languageServiceHost: LanguageServiceHost;
    private _services: ts.LanguageService;

    private _outputChannel: vs.OutputChannel;

    constructor() {
        this._languageServiceHost = new LanguageServiceHost();

        this._services = ts.createLanguageService(
            this._languageServiceHost, ts.createDocumentRegistry());
    }

    documentThis(editor: vs.TextEditor, commandName: string, forCompletion: boolean) {
        const sourceFile = this._getSourceFile(editor.document);

        const selection = editor.selection;
        const caret = selection.start;

        const position = ts.getPositionOfLineAndCharacter(sourceFile, caret.line, caret.character);
        const node = utils.findChildForPosition(sourceFile, position);
        const documentNode = utils.nodeIsOfKind(node) ? node : utils.findFirstParent(node);

        if (!documentNode) {
            this._showFailureMessage(commandName, "at the current position");
            return;
        }

        const sb = new utils.SnippetStringBuilder();

        const docLocation = this._documentNode(sb, documentNode, sourceFile);

        if (docLocation) {
            this._insertDocumentation(sb, docLocation, editor, forCompletion);
        } else {
            this._showFailureMessage(commandName, "at the current position");
        }
    }

    traceNode(editor: vs.TextEditor) {
        const selection = editor.selection;
        const caret = selection.start;

        const sourceFile = this._getSourceFile(editor.document);

        const position = ts.getPositionOfLineAndCharacter(sourceFile, caret.line, caret.character);
        const node = utils.findChildForPosition(sourceFile, position);

        const nodes: string[] = [];

        let parent = node;
        while (parent) {
            nodes.push(this._printNodeInfo(parent, sourceFile));
            parent = parent.parent;
        }

        const sb = new utils.StringBuilder();
        nodes.reverse().forEach((n, i) => {
            sb.appendLine(n);
        });

        if (!this._outputChannel) {
            this._outputChannel = vs.window.createOutputChannel("TypeScript Syntax Node Trace");
        }

        this._outputChannel.show();
        this._outputChannel.appendLine(sb.toString());
    }

    private _printNodeInfo(node: ts.Node, sourceFile: ts.SourceFile) {
        const sb = new utils.StringBuilder();
        sb.append(`${ node.getStart() } to ${ node.getEnd() } --- (${node.kind}) ${ (<any>ts).SyntaxKind[node.kind] }`);

        if (node.parent) {
            const nodeIndex = node.parent.getChildren().indexOf(node);

            if (nodeIndex !== -1) {
                sb.append(` - Index of parent: ${nodeIndex}`);
            }
        }

        sb.appendLine();

        const column = sourceFile.getLineAndCharacterOfPosition(node.getStart()).character;
        for (let i = 0; i < column; i++) {
            sb.append(" ");
        }

        sb.appendLine(node.getText());

        return sb.toString();
    }

    private _showFailureMessage(commandName: string, condition: string) {
        vs.window.showErrorMessage(`Sorry! '${commandName}' wasn't able to produce documentation ${condition}.`);
    }

    private _insertDocumentation(sb: utils.SnippetStringBuilder, location: ts.LineAndCharacter, editor: vs.TextEditor, forCompletion: boolean) {
        const startPosition = new vs.Position(forCompletion ? location.line - 1 : location.line, location.character);
        const endPosition = new vs.Position(location.line, location.character);

        const range = new Range(startPosition, endPosition);

        editor.insertSnippet(sb.toCommentValue(), range);
    }

    private _getSourceFile(document: vs.TextDocument) {
        const fileText = document.getText();
        const canonicalFileName = utils.getDocumentFileName(document);
        this._languageServiceHost.updateCurrentFile(canonicalFileName, fileText);

        this._services.getSyntacticDiagnostics(canonicalFileName);

        const sourceFile = this._services.getProgram().getSourceFile(canonicalFileName);

        const newText = document.getText();
        sourceFile.update(newText, <ts.TextChangeRange>{
            newLength: newText.length,
            span: <ts.TextSpan>{
                start: 0,
                length: newText.length
            }
        });

        return sourceFile;
    }

    private _documentNode(sb: utils.SnippetStringBuilder, node: ts.Node, sourceFile: ts.SourceFile): ts.LineAndCharacter {
        switch (node.kind) {
            case ts.SyntaxKind.ClassDeclaration:
                this._emitClassDeclaration(sb, <ts.ClassDeclaration>node);
                break;
            case ts.SyntaxKind.PropertyDeclaration:
            case ts.SyntaxKind.PropertySignature:
            case ts.SyntaxKind.GetAccessor:
            case ts.SyntaxKind.SetAccessor:
                this._emitPropertyDeclaration(sb, <ts.AccessorDeclaration>node);
                break;
            case ts.SyntaxKind.InterfaceDeclaration:
                this._emitInterfaceDeclaration(sb, <ts.InterfaceDeclaration>node);
                break;
            case ts.SyntaxKind.EnumDeclaration:
                this._emitEnumDeclaration(sb, <ts.EnumDeclaration>node);
                break;
            case ts.SyntaxKind.EnumMember:
                sb.appendLine();
                break;
            case ts.SyntaxKind.FunctionDeclaration:
            case ts.SyntaxKind.MethodDeclaration:
            case ts.SyntaxKind.MethodSignature:
                this._emitMethodDeclaration(sb, <ts.MethodDeclaration>node);
                break;
            case ts.SyntaxKind.Constructor:
                this._emitConstructorDeclaration(sb, <ts.ConstructorDeclaration>node);
                break;
            case ts.SyntaxKind.FunctionExpression:
            case ts.SyntaxKind.ArrowFunction:
                return this._emitFunctionExpression(sb, <ts.FunctionExpression>node, sourceFile);
            case ts.SyntaxKind.VariableDeclaration:
                return this._emitVariableDeclaration(sb, <ts.VariableDeclaration>node, sourceFile);
            default:
                return;
        }

        return ts.getLineAndCharacterOfPosition(sourceFile, node.getStart());
    }

    private _emitDescriptionHeader(sb: utils.SnippetStringBuilder) {
        sb.appendLine();
        sb.appendLine();
        sb.appendSnippetTabstop();
        sb.appendLine();
    }

    private _emitAuthor(sb: utils.SnippetStringBuilder) {
        if (vs.workspace.getConfiguration().get("docthis.includeAuthorTag", false)) {
            let author: string = vs.workspace.getConfiguration().get("docthis.authorName", "");
            sb.append("Author: " + author);
            sb.append("");
            sb.appendSnippetTabstop();
            sb.appendLine();
        }
    }

    private _emitVariableDeclaration(sb: utils.SnippetStringBuilder, node: ts.VariableDeclaration, sourceFile: ts.SourceFile) {
        for (const child of node.getChildren()) {
            const result = this._documentNode(sb, child, sourceFile);
            if (result) {
                return result;
            }
        }

        return;
    }

    private _emitFunctionExpression(sb: utils.SnippetStringBuilder, node: ts.FunctionExpression | ts.ArrowFunction, sourceFile: ts.SourceFile) {
        let targetNode = node.parent;

        if (node.parent.kind !== ts.SyntaxKind.PropertyAssignment &&
            node.parent.kind !== ts.SyntaxKind.BinaryExpression &&
            node.parent.kind !== ts.SyntaxKind.PropertyDeclaration) {

            targetNode = utils.findFirstParent(targetNode, [ts.SyntaxKind.VariableDeclarationList, ts.SyntaxKind.VariableDeclaration]);
            if (!targetNode) {
                return;
            }
        }

        this._emitDescriptionHeader(sb);

        this._emitTypeParameters(sb, node);
        this._emitParameters(sb, node);
        this._emitReturns(sb, node);

        return ts.getLineAndCharacterOfPosition(sourceFile, targetNode.getStart());
    }

    private _emitClassDeclaration(sb: utils.SnippetStringBuilder, node: ts.ClassDeclaration) {
        sb.append("Class:");

        if (node.name) {
            sb.append(` ${ node.name.getText() }`);
        }

        this._emitDescriptionHeader(sb);
        this._emitAuthor(sb);
        this._emitModifiers(sb, node);
        this._emitHeritageClauses(sb, node);
        this._emitTypeParameters(sb, node);
    }

    private _emitPropertyDeclaration(sb: utils.SnippetStringBuilder, node: ts.PropertyDeclaration | ts.AccessorDeclaration) {
        sb.append("Property:");

        if (node.name) {
            sb.append(` ${ node.name.getText() }`);
        }

        this._emitDescriptionHeader(sb);

        if (node.kind === ts.SyntaxKind.GetAccessor) {
            const name = utils.findFirstChildOfKindDepthFirst(node, [ts.SyntaxKind.Identifier]).getText();
            const parentClass = <ts.ClassDeclaration>node.parent;

            let hasSetter = !!parentClass.members.find(c => c.kind === ts.SyntaxKind.SetAccessor &&
                utils.findFirstChildOfKindDepthFirst(c, [ts.SyntaxKind.Identifier]).getText() === name);

            if (!hasSetter) {
                sb.appendLine("@readonly");
            }
        }

        this._emitModifiers(sb, node);
    }

    private _emitInterfaceDeclaration(sb: utils.SnippetStringBuilder, node: ts.InterfaceDeclaration) {
        this._emitDescriptionHeader(sb);
        this._emitAuthor(sb);

        this._emitModifiers(sb, node);

        sb.appendLine(`@interface ${ node.name.getText() }`);

        this._emitHeritageClauses(sb, node);
        this._emitTypeParameters(sb, node);
    }

    private _emitEnumDeclaration(sb: utils.SnippetStringBuilder, node: ts.EnumDeclaration) {
        this._emitDescriptionHeader(sb);

        this._emitModifiers(sb, node);

        sb.appendLine(`@enum {number}`);
    }

    private _emitFunctionName(sb: utils.SnippetStringBuilder, node: ts.MethodDeclaration | ts.FunctionDeclaration) {
        sb.append(`Function: ${node.name.getText()}`);
    }

    private _emitMethodDeclaration(sb: utils.SnippetStringBuilder, node: ts.MethodDeclaration | ts.FunctionDeclaration) {
        this._emitFunctionName(sb, node);
        this._emitDescriptionHeader(sb);
        this._emitAuthor(sb);

        this._emitModifiers(sb, node);
        this._emitTypeParameters(sb, node);
        this._emitParameters(sb, node);
        this._emitReturns(sb, node);
    }

    private _emitReturns(sb: utils.SnippetStringBuilder, node: ts.MethodDeclaration | ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction) {
        if (utils.findNonVoidReturnInCurrentScope(node) || (node.type && node.type.getText() !== "void")) {
            sb.appendLine("");
            sb.appendLine("Returns:");
            sb.append("\t");
            sb.appendSnippetTabstop();
            sb.appendLine();
        }

    }

    private _emitParameters(sb: utils.SnippetStringBuilder, node:
        ts.MethodDeclaration | ts.FunctionDeclaration | ts.ConstructorDeclaration | ts.FunctionExpression | ts.ArrowFunction) {

        if (!node.parameters || node.parameters.length === 0) {
            return;
        }

        sb.appendLine();
        sb.appendLine("Parameters:");

        node.parameters.forEach(parameter => {
            const name = parameter.name.getText();

            sb.append("\t- ");
            sb.append(name);
            sb.append(" - ");
            sb.appendSnippetTabstop();
            sb.appendLine();
        });
    }

    private _emitConstructorDeclaration(sb: utils.SnippetStringBuilder, node: ts.ConstructorDeclaration) {
        sb.appendSnippetPlaceholder(`Creates an instance of ${
            (<ts.ClassDeclaration>node.parent).name.getText()
            }.`);
        sb.appendLine();
        this._emitAuthor(sb);

        this._emitParameters(sb, node);
    }

    private _emitTypeParameters(sb: utils.SnippetStringBuilder, node: ts.ClassLikeDeclaration | ts.InterfaceDeclaration | ts.MethodDeclaration | ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction) {
        if (!node.typeParameters) {
            return;
        }

        node.typeParameters.forEach(parameter => {
            sb.append(`@template ${ parameter.name.getText() } `);
            sb.appendSnippetTabstop();
            sb.appendLine();
        });
    }

    private _emitHeritageClauses(sb: utils.SnippetStringBuilder, node: ts.ClassLikeDeclaration | ts.InterfaceDeclaration) {
        if (!node.heritageClauses || !includeTypes()) {
            return;
        }

        node.heritageClauses.forEach((clause) => {
            const heritageType = clause.token === ts.SyntaxKind.ExtendsKeyword ? "@extends" : "@implements";

            clause.types.forEach(t => {
                let tn = t.expression.getText();
                if (t.typeArguments) {
                    tn += "<";
                    tn += t.typeArguments.map(a => a.getText()).join(", ");
                    tn += ">";
                }

                sb.append(`${ heritageType } ${ utils.formatTypeName(tn) }`);
                sb.appendLine();
            });
        });
    }

    private _emitModifiers(sb: utils.SnippetStringBuilder, node: ts.Node) {
        if (!node.modifiers) {
            return;
        }

        node.modifiers.forEach(modifier => {
            switch (modifier.kind) {
                case ts.SyntaxKind.ExportKeyword:
                    sb.appendLine("@export"); return;
                case ts.SyntaxKind.AbstractKeyword:
                    sb.appendLine("@abstract"); return;
                case ts.SyntaxKind.ProtectedKeyword:
                    sb.appendLine("@protected"); return;
                case ts.SyntaxKind.PrivateKeyword:
                    sb.appendLine("@private"); return;
                case ts.SyntaxKind.StaticKeyword:
                    sb.appendLine("@static"); return;
            }
        });
    }

    dispose() {
        if (this._outputChannel) {
            this._outputChannel.dispose();
        }

        this._services.dispose();
    }
}
