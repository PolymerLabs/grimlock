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

import {Writable} from 'stream';

export abstract class Node {
  abstract emit(writer: Writable): void;
}

export abstract class Expression extends Node {}
export abstract class Command extends Node {}

export class File implements Node {
  commands: Command[];

  constructor(commands: Command[]) {
    this.commands = commands;
  }

  emit(writer: Writable) {
    this.commands.forEach((c) => c.emit(writer));
  }
}

export class Namespace extends Command {
  value: string;

  constructor(value: string) {
    super();
    this.value = value;
  }

  emit(writer: Writable) {
    writer.write(`{namespace ${this.value}}\n`);
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

  emit(writer: Writable) {
    writer.write(`\n{template .${this.name}}\n`);
    this.commands.forEach((c) => c.emit(writer));
    writer.write(`\n{/template}\n`);
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

  emit(writer: Writable) {
    const typeString = this.type === undefined ? '' : `: ${this.type}`;
    writer.write(`  {@param ${this.name}${typeString}}\n`);
  }
}

export class RawText extends Command {
  value: string;

  constructor(value: string) {
    super();
    this.value = value;
  }

  emit(writer: Writable) {
    writer.write(this.value);
  }
}

export class Print extends Command {
  child: Expression;

  constructor(child: Expression) {
    super();
    this.child = child;
  }

  emit(writer: Writable) {
    writer.write('{');
    this.child.emit(writer);
    writer.write('}');
  }
}

export class Block extends Command {
  children: Command[];

  constructor(children: Command[]) {
    super();
    this.children = children;
  }

  emit(writer: Writable) {
    this.children.forEach((c) => c.emit(writer));
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

  emit(writer: Writable) {
    if (this.value instanceof Expression) {
      writer.write(`{param ${this.name}: `);
      this.value.emit(writer);
      writer.write(` /}`);
    } else {
      const kindString = this.kind === undefined ? '' : ` kind="${this.kind}"`;
      writer.write(`\n{param ${this.name}${kindString}}`);
      this.value.emit(writer);
      writer.write(`\n{/param}`);
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

  emit(writer: Writable) {
    const hasParameters = this.parameters.length !== 0;
    const selfClose = hasParameters ? '' : ' /';
    writer.write(`{call .${this.templateName}${selfClose}}`);
    this.parameters.forEach((p) => p.emit(writer));
    if (hasParameters) {
      writer.write(`\n{/call}`);
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

  emit(writer: Writable) {
    writer.write('\n{if ');
    this.condition.emit(writer);
    writer.write('}\n');
    this.whenTrue.forEach((c) => c.emit(writer));
    writer.write('\n{else}\n');
    this.whenFalse.forEach((c) => c.emit(writer));
    writer.write('\n{/if}\n');
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

  emit(writer: Writable) {
    writer.write(`\n{for $${this.identifier} in `);
    this.expression.emit(writer);
    writer.write('}\n');
    this.body.forEach((c) => c.emit(writer));
    writer.write('\n{/for}\n');
  }
}

export abstract class Literal extends Expression {
  text: string;

  constructor(value: string) {
    super();
    this.text = value;
  }

  emit(writer: Writable) {
    writer.write(this.text);
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

  emit(writer: Writable) {
    writer.write('$');
    writer.write(this.value);
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

  emit(writer: Writable) {
    writer.write(this.operator);
    this.child.emit(writer);
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

  emit(writer: Writable) {
    this.left.emit(writer);
    writer.write(` ${this.operator} `);
    this.right.emit(writer);
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

  emit(writer: Writable) {
    this.receiver.emit(writer);
    writer.write('.');
    writer.write(this.name);
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

  emit(writer: Writable) {
    writer.write(this.functionName);
    writer.write('(');
    this.arguments.forEach((a, i) => {
      a.emit(writer);
      if (i < this.arguments.length - 1) {
        writer.write(', ');
      }
    });
    writer.write(')');
  }
}

export class ErrorExpression extends Expression {
  emit(_writer: Writable) {
    throw new Error('Cannot emit Empty Soy nodes');
  }
}

export class Paren extends Expression {
  child: Expression;

  constructor(child: Expression) {
    super();
    this.child = child;
  }

  emit(writer: Writable) {
    writer.write('(');
    this.child.emit(writer);
    writer.write(')');
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

  emit(writer: Writable) {
    this.receiver.emit(writer);
    writer.write('[');
    this.argument.emit(writer);
    writer.write(']');
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

  emit(writer: Writable) {
    this.condition.emit(writer);
    writer.write(' ? ');
    this.trueExpr.emit(writer);
    writer.write(' : ');
    this.falseExpr.emit(writer);
  }
}

export class MapLiteral {
  entries: {[key: string]: Expression | null} | null;

  constructor(entries: {[key: string]: Expression | null} | null) {
    this.entries = entries;
  }
}

export class ListLiteral {
  items: Array<Expression> | null;

  constructor(items: Array<Expression> | null) {
    this.items = items;
  }
}
