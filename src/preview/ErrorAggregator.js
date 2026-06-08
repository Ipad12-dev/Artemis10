/**
 * ErrorAggregator - Collects and categorizes errors
 */

export class ErrorAggregator {
  constructor() {
    this.errors = [];
  }

  addError(type, message, context = {}) {
    this.errors.push({
      type,
      message,
      context,
      timestamp: Date.now(),
    });
  }

  categorizeErrors() {
    const categories = {
      syntax: [],
      transpile: [],
      module: [],
      runtime: [],
      unhandled: [],
      entry: [],
      other: [],
    };

    for (const error of this.errors) {
      if (error.type.includes('syntax')) {
        categories.syntax.push(error);
      } else if (error.type.includes('transpile')) {
        categories.transpile.push(error);
      } else if (error.type.includes('module')) {
        categories.module.push(error);
      } else if (error.type.includes('runtime')) {
        categories.runtime.push(error);
      } else if (error.type.includes('unhandled')) {
        categories.unhandled.push(error);
      } else if (error.type.includes('entry')) {
        categories.entry.push(error);
      } else {
        categories.other.push(error);
      }
    }

    return categories;
  }

  getMessageForUser() {
    const categories = this.categorizeErrors();

    if (categories.entry.length > 0) {
      return categories.entry[0].message;
    }

    if (categories.syntax.length > 0) {
      const first = categories.syntax[0];
      return `Syntax Error in ${first.context.path}:\n${first.message}`;
    }

    if (categories.module.length > 0) {
      const first = categories.module[0];
      return `Module Error:\n${first.message}`;
    }

    if (categories.runtime.length > 0) {
      const first = categories.runtime[0];
      return `Runtime Error:\n${first.message}`;
    }

    if (this.errors.length > 0) {
      return `Preview Error:\n${this.errors[0].message}`;
    }

    return 'Unknown error';
  }

  clear() {
    this.errors = [];
  }
}