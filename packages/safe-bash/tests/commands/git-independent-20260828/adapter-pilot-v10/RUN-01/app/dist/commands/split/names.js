export class Names {
    args;
    limits;
    digits;
    extension = "";
    first = true;
    constructor(args, limits) {
        this.args = args;
        this.limits = limits;
        this.digits = Array.from({ length: args.suffixLength }, () => 0);
        if (args.alphabet[0] === "0") {
            const start = args.numericStart.padStart(args.suffixLength, "0");
            this.digits = Array.from(start, digit => Number(digit));
        }
    }
    next() {
        if (!this.first) {
            let advanced = false;
            for (let index = this.digits.length - 1; index >= 0; index--) {
                this.digits[index] = this.digits[index] + 1;
                if (index === 0 && this.args.automatic && this.digits[index] === this.args.alphabet.length - 1) {
                    if (this.extension.length + this.digits.length + 2 > this.limits.maxSuffixLength)
                        throw new Error("split suffix length limit exceeded");
                    this.extension += this.args.alphabet.at(-1);
                    this.digits = Array.from({ length: this.digits.length + 1 }, () => 0);
                    advanced = true;
                    break;
                }
                if (this.digits[index] < this.args.alphabet.length) {
                    advanced = true;
                    break;
                }
                this.digits[index] = 0;
            }
            if (!advanced)
                throw new Error("output file suffixes exhausted");
        }
        this.first = false;
        return this.args.prefix + this.extension + this.digits.map(digit => this.args.alphabet[digit]).join("") + this.args.additionalSuffix;
    }
}
//# sourceMappingURL=names.js.map