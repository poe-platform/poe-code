export interface MenuOption {
    label: string;
    value: string;
    hint?: string;
}
export interface RenderMenuOptions {
    message: string;
    options: MenuOption[];
    selectedIndex?: number;
}
export declare function renderMenu(opts: RenderMenuOptions): string;
