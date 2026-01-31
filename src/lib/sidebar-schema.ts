import { toJSONSchema, z } from "zod";

const importanceSchema = z.enum(["primary", "secondary"]).optional();

export const SelectOptionSchema = z.object({
    value: z.string(),
    label: z.string(),
});

export const MarkdownBlockSchema = z.object({
    type: z.literal("markdown"),
    content: z.string(),
    importance: importanceSchema,
});

export const ButtonBlockSchema = z.object({
    type: z.literal("button"),
    label: z.string(),
    actionId: z.string(),
    importance: importanceSchema,
});

export const LinkBlockSchema = z.object({
    type: z.literal("link"),
    label: z.string(),
    actionId: z.string(),
    importance: importanceSchema,
});

export const InputBlockSchema = z.object({
    type: z.literal("input"),
    label: z.string(),
    actionId: z.string(),
    inputType: z.enum(["text", "email", "search", "password"]).optional(),
    placeholder: z.string().optional(),
    importance: importanceSchema,
});

export const SelectBlockSchema = z.object({
    type: z.literal("select"),
    label: z.string(),
    actionId: z.string(),
    options: z.array(SelectOptionSchema).min(1),
    importance: importanceSchema,
});

export const SidebarBlockSchema = z.discriminatedUnion("type", [
    MarkdownBlockSchema,
    ButtonBlockSchema,
    LinkBlockSchema,
    InputBlockSchema,
    SelectBlockSchema,
]);

export const BlocksResponseSchema = z.array(SidebarBlockSchema);

export type SidebarBlockInferred = z.infer<typeof SidebarBlockSchema>;

/** JSON Schema for the blocks array, for use in the LLM prompt. */
export function getBlocksResponseJSONSchema(): string {
    const schema = toJSONSchema(BlocksResponseSchema);
    const { $schema, ...rest } = schema as { $schema?: string; [k: string]: unknown };
    return JSON.stringify(rest, null, 0).replace(/\s+/g, " ").trim();
}
