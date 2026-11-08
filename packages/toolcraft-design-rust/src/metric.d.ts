export declare function createMetric({ capacity, unit }: {
    capacity: number;
    unit: string;
}): {
    push(value: number | null): void;
    samples(): (number | null)[];
    render(width: number): string;
};
