/**
 * @license
 * Copyright (c) 2019 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at
 * http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at
 * http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */

export abstract class Node {
  abstract emit(): IterableIterator<string>;
}

export abstract class Expression extends Node {}
export abstract class Command extends Node {}

export class File implements Node {
  commands: Command[];

  constructor(commands: Command[]) {
    this.commands = commands;
  }

  *emit() {
    for (const command of this.commands) {
      yield* command.emit();
    }
  }
}

export class Namespace extends Command {
  value: string;

  constructor(value: string) {
    super();
    this.value = value;
  }

  *emit() {
    yield `{namespace ${this.value}}\n`;
  }
}

export class Template extends Command {
  name: string;
  commands: Command[];

  constructor(name: string, commands: Command[]) {
    super();
    this.name = name;
    this.commands = commands;
  }

  *emit() {
    yield `\n{template .${this.name}}\n`;
    for (const command of this.commands) {
      yield* command.emit();
    }
    yield `\n{/template}\n`;
  }
}

export class TemplateParameter extends Command {
  name: string;
  type: string | undefined;

  constructor(name: string, type: string | undefined) {
    super();
    this.name = name;
    this.type = type;
  }

  *emit() {
    const typeString = this.type === undefined ? '' : `: ${this.type}`;
    yield `  {@param ${this.name}${typeString}}\n`;
  }
}

export class RawText extends Command {
  value: string;

  constructor(value: string) {
    super();
    this.value = value;
  }

  *emit() {
    yield this.value;
  }
}

export class Print extends Command {
  child: Expression;

  constructor(child: Expression) {
    super();
    this.child = child;
  }

  *emit() {
    yield '{';
    yield* this.child.emit();
    yield '}';
  }
}

export class Block extends Command {
  children: Command[];

  constructor(children: Command[]) {
    super();
    this.children = children;
  }

  *emit() {
    for (const child of this.children) {
      yield* child.emit();
    }
  }
}

export class CallParameter extends Command {
  name: string;
  value: Node;
  kind?: string;

  constructor(name: string, value: Node, kind?: string) {
    super();
    this.name = name;
    this.value = value;
    this.kind = kind;
  }

  *emit() {
    if (this.value instanceof Expression) {
      yield `{param ${this.name}: `;
      yield* this.value.emit();
      yield ` /}`;
    } else {
      const kindString = this.kind === undefined ? '' : ` kind="${this.kind}"`;
      yield `\n{param ${this.name}${kindString}}`;
      yield* this.value.emit();
      yield `\n{/param}`;
    }
  }
}

export class CallCommand extends Command {
  templateName: string;
  parameters: Array<CallParameter>;

  constructor(templateName: string, parameters: Array<CallParameter>) {
    super();
    this.templateName = templateName;
    this.parameters = parameters;
  }

  *emit() {
    const hasParameters = this.parameters.length !== 0;
    const selfClose = hasParameters ? '' : ' /';
    yield `{call .${this.templateName}${selfClose}}`;
    for (const parameter of this.parameters) {
      yield* parameter.emit();
    }
    if (hasParameters) {
      yield `\n{/call}`;
    }
  }
}

export class IfCommand extends Command {
  condition: Expression;
  whenTrue: Command[];
  whenFalse: Command[];

  constructor(
    condition: Expression,
    whenTrue: Command[],
    whenFalse: Command[]
  ) {
    super();
    this.condition = condition;
    this.whenTrue = whenTrue;
    this.whenFalse = whenFalse;
  }

  *emit() {
    yield '\n{if ';
    yield* this.condition.emit();
    yield '}\n';
    for (const c of this.whenTrue) {
      yield* c.emit();
    }
    yield '\n{else}\n';
    for (const c of this.whenFalse) {
      yield* c.emit();
    }
    yield '\n{/if}\n';
  }
}

export class ForCommand extends Command {
  identifier: string;
  expression: Expression;
  body: Command[];

  constructor(identifier: string, expression: Expression, body: Command[]) {
    super();
    this.identifier = identifier;
    this.expression = expression;
    this.body = body;
  }

  *emit() {
    yield `\n{for $${this.identifier} in `;
    yield* this.expression.emit();
    yield '}\n';
    for (const command of this.body) {
      yield* command.emit();
    }
    yield '\n{/for}\n';
  }
}

export class LetCommand extends Command {
  identifier: string;
  value: Node;
  kind?: string;

  constructor(identifier: string, value: Node, kind?: string) {
    super();
    this.identifier = identifier;
    this.value = value;
    this.kind = kind;
  }

  *emit() {
    if (this.value instanceof Expression) {
      yield `\n{let $${this.identifier}: `;
      yield* this.value.emit();
      yield ' /}\n';
    } else {
      const kindString = this.kind === undefined ? '' : ` kind="${this.kind}"`;
      yield `\n{let $${this.identifier}${kindString}}\n`;
      yield* this.value.emit();
      yield '\n{/let}\n';
    }
  }
}

export abstract class Literal extends Expression {
  text: string;

  constructor(value: string) {
    super();
    this.text = value;
  }

  *emit() {
    yield this.text;
  }
}

export class NumberLiteral extends Literal {}

export class BooleanLiteral extends Literal {}

export class NullLiteral extends Literal {
  constructor() {
    super('null');
  }
}

export class StringLiteral extends Literal {}

export class Identifier extends Expression {
  value: string;

  constructor(value: string) {
    super();
    this.value = value;
  }

  *emit() {
    yield '$';
    yield this.value;
  }
}

export class UnaryOperator extends Expression {
  operator: string;
  child: Expression;

  constructor(operator: string, child: Expression) {
    super();
    this.operator = operator;
    this.child = child;
  }

  *emit() {
    yield this.operator;
    yield* this.child.emit();
  }
}

export class BinaryOperator extends Expression {
  operator: string;
  left: Expression;
  right: Expression;

  constructor(operator: string, left: Expression, right: Expression) {
    super();
    this.operator = operator;
    this.left = left;
    this.right = right;
  }

  *emit() {
    yield* this.left.emit();
    yield ` ${this.operator} `;
    yield* this.right.emit();
  }
}

export class PropertyAccess extends Expression {
  receiver: Expression;
  name: string;

  constructor(receiver: Expression, name: string) {
    super();
    this.receiver = receiver;
    this.name = name;
  }

  *emit() {
    yield* this.receiver.emit();
    yield '.';
    yield this.name;
  }
}

export class CallExpression extends Expression {
  functionName: string;
  arguments: Expression[];

  constructor(functionName: string, args: Expression[]) {
    super();
    this.functionName = functionName;
    this.arguments = args;
  }

  *emit() {
    yield this.functionName;
    yield '(';
    let i = 0;
    for (const argument of this.arguments) {
      yield* argument.emit();
      if (i++ < this.arguments.length - 1) {
        yield ', ';
      }
    }
    yield ')';
  }
}

export class ErrorExpression extends Expression {
  *emit() {
    throw new Error('Cannot emit Empty Soy nodes');
  }
}

export class Paren extends Expression {
  child: Expression;

  constructor(child: Expression) {
    super();
    this.child = child;
  }

  *emit() {
    yield '(';
    yield* this.child.emit();
    yield ')';
  }
}

export class Index extends Expression {
  receiver: Expression;
  argument: Expression;

  constructor(receiver: Expression, argument: Expression) {
    super();
    this.receiver = receiver;
    this.argument = argument;
  }

  *emit() {
    yield* this.receiver.emit();
    yield '[';
    yield* this.argument.emit();
    yield ']';
  }
}

export class Ternary {
  condition: Expression;
  trueExpr: Expression;
  falseExpr: Expression;

  constructor(
    condition: Expression,
    trueExpr: Expression,
    falseExpr: Expression
  ) {
    this.condition = condition;
    this.trueExpr = trueExpr;
    this.falseExpr = falseExpr;
  }

  *emit() {
    yield* this.condition.emit();
    yield ' ? ';
    yield* this.trueExpr.emit();
    yield ' : ';
    yield* this.falseExpr.emit();
  }
}

export class Record extends Expression {
  entries: Array<[string, Expression]>;

  constructor(entries: Array<[string, Expression]>) {
    super();
    this.entries = entries;
  }

  *emit() {
    yield 'record(';
    let i = 0;
    for (const [key, value] of this.entries) {
      yield `${key}: `;
      yield* value.emit();
      if (i++ < this.entries.length - 1) {
        yield ', ';
      }
    }
    yield ')';
  }
}
