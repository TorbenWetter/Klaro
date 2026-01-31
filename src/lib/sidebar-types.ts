/**
 * Structured sidebar blocks returned by the LLM. Rendered in order in a single flow.
 */

export type SidebarBlock = MarkdownBlock | ButtonBlock | LinkBlock | InputBlock | SelectBlock;

export interface MarkdownBlock {
    type: "markdown";
    content: string;
    importance?: "primary" | "secondary";
}

export interface ButtonBlock {
    type: "button";
    label: string;
    actionId: string;
    importance?: "primary" | "secondary";
}

export interface LinkBlock {
    type: "link";
    label: string;
    actionId: string;
    importance?: "primary" | "secondary";
}

export interface InputBlock {
    type: "input";
    label: string;
    actionId: string;
    inputType?: "text" | "email" | "search" | "password";
    placeholder?: string;
    importance?: "primary" | "secondary";
}

export interface SelectOption {
    value: string;
    label: string;
}

export interface SelectBlock {
    type: "select";
    label: string;
    actionId: string;
    options: SelectOption[];
    importance?: "primary" | "secondary";
}

export function isMarkdownBlock(b: SidebarBlock): b is MarkdownBlock {
    return b.type === "markdown";
}
export function isButtonBlock(b: SidebarBlock): b is ButtonBlock {
    return b.type === "button";
}
export function isLinkBlock(b: SidebarBlock): b is LinkBlock {
    return b.type === "link";
}
export function isInputBlock(b: SidebarBlock): b is InputBlock {
    return b.type === "input";
}
export function isSelectBlock(b: SidebarBlock): b is SelectBlock {
    return b.type === "select";
}
