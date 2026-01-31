import { z } from 'zod';

// ============================================================================
// BASE TYPES
// ============================================================================

/** Action binding - links UI element to a real page element */
const ActionBinding = z.object({
  /** ID of the element on the real page (data-acc-id) */
  elementId: z.string(),
  /** Type of action to perform */
  action: z.enum(['click', 'focus', 'scroll']).default('click'),
});

export type ActionBinding = z.infer<typeof ActionBinding>;

// ============================================================================
// TEXT/DISPLAY COMPONENTS
// ============================================================================

/** Simple heading (h1-h6) */
export const HeadingNode = z.object({
  type: z.literal('heading'),
  level: z.number().min(1).max(6),
  text: z.string(),
});

/** Paragraph of text */
export const ParagraphNode = z.object({
  type: z.literal('paragraph'),
  text: z.string(),
});

/** Inline text with optional styling */
export const TextNode = z.object({
  type: z.literal('text'),
  text: z.string(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
});

/** Alert component for important messages */
export const AlertNode = z.object({
  type: z.literal('alert'),
  variant: z.enum(['default', 'destructive']).optional(),
  title: z.string().optional(),
  description: z.string(),
});

/** Badge for labels/status */
export const BadgeNode = z.object({
  type: z.literal('badge'),
  text: z.string(),
  variant: z.enum(['default', 'secondary', 'destructive', 'outline']).optional(),
});

/** Progress indicator */
export const ProgressNode = z.object({
  type: z.literal('progress'),
  value: z.number().min(0).max(100),
  label: z.string().optional(),
});

/** Separator/divider */
export const SeparatorNode = z.object({
  type: z.literal('separator'),
  orientation: z.enum(['horizontal', 'vertical']).optional(),
});

// ============================================================================
// INTERACTIVE COMPONENTS
// ============================================================================

/** Button component */
export const ButtonNode = z.object({
  type: z.literal('button'),
  label: z.string(),
  variant: z.enum(['default', 'secondary', 'outline', 'destructive', 'ghost', 'link']).optional(),
  size: z.enum(['default', 'sm', 'lg', 'icon']).optional(),
  disabled: z.boolean().optional(),
  /** Binds this button to a real page element */
  actionBinding: ActionBinding.optional(),
});

/** Text input */
export const InputNode = z.object({
  type: z.literal('input'),
  label: z.string(),
  placeholder: z.string().optional(),
  value: z.string().optional(),
  inputType: z.enum(['text', 'email', 'password', 'number', 'tel', 'url', 'search']).optional(),
  disabled: z.boolean().optional(),
  required: z.boolean().optional(),
  /** Binds this input to a real page element */
  actionBinding: ActionBinding.optional(),
});

/** Textarea for multi-line input */
export const TextareaNode = z.object({
  type: z.literal('textarea'),
  label: z.string(),
  placeholder: z.string().optional(),
  value: z.string().optional(),
  rows: z.number().optional(),
  disabled: z.boolean().optional(),
  required: z.boolean().optional(),
  /** Binds this textarea to a real page element */
  actionBinding: ActionBinding.optional(),
});

/** Checkbox */
export const CheckboxNode = z.object({
  type: z.literal('checkbox'),
  label: z.string(),
  checked: z.boolean().optional(),
  disabled: z.boolean().optional(),
  /** Binds this checkbox to a real page element */
  actionBinding: ActionBinding.optional(),
});

/** Switch toggle */
export const SwitchNode = z.object({
  type: z.literal('switch'),
  label: z.string(),
  checked: z.boolean().optional(),
  disabled: z.boolean().optional(),
  /** Binds this switch to a real page element */
  actionBinding: ActionBinding.optional(),
});

/** Radio group option */
const RadioOption = z.object({
  value: z.string(),
  label: z.string(),
  disabled: z.boolean().optional(),
});

/** Radio group */
export const RadioGroupNode = z.object({
  type: z.literal('radioGroup'),
  label: z.string(),
  options: z.array(RadioOption).min(1),
  defaultValue: z.string().optional(),
  disabled: z.boolean().optional(),
  /** Binds this radio group to a real page element */
  actionBinding: ActionBinding.optional(),
});

/** Select option */
const SelectOption = z.object({
  value: z.string(),
  label: z.string(),
  disabled: z.boolean().optional(),
});

/** Select dropdown */
export const SelectNode = z.object({
  type: z.literal('select'),
  label: z.string(),
  placeholder: z.string().optional(),
  options: z.array(SelectOption).min(1),
  defaultValue: z.string().optional(),
  disabled: z.boolean().optional(),
  /** Binds this select to a real page element */
  actionBinding: ActionBinding.optional(),
});

// ============================================================================
// NAVIGATION COMPONENTS
// ============================================================================

/** Breadcrumb item */
const BreadcrumbItem = z.object({
  label: z.string(),
  href: z.string().optional(),
  actionBinding: ActionBinding.optional(),
  isCurrent: z.boolean().optional(),
});

/** Breadcrumb navigation */
export const BreadcrumbNode = z.object({
  type: z.literal('breadcrumb'),
  items: z.array(BreadcrumbItem).min(1),
});

/** Navigation link */
const NavLink = z.object({
  label: z.string(),
  href: z.string().optional(),
  actionBinding: ActionBinding.optional(),
  active: z.boolean().optional(),
});

/** Navigation menu */
export const NavigationMenuNode = z.object({
  type: z.literal('navigationMenu'),
  items: z.array(NavLink).min(1),
  orientation: z.enum(['horizontal', 'vertical']).optional(),
});

/** Pagination */
export const PaginationNode = z.object({
  type: z.literal('pagination'),
  currentPage: z.number().min(1),
  totalPages: z.number().min(1),
  /** Action binding for page navigation */
  actionBinding: ActionBinding.optional(),
});

// ============================================================================
// DATA COMPONENTS
// ============================================================================

/** Table cell */
const TableCell = z.object({
  content: z.string(),
  isHeader: z.boolean().optional(),
});

/** Table row */
const TableRow = z.object({
  cells: z.array(TableCell).min(1),
});

/** Table component */
export const TableNode = z.object({
  type: z.literal('table'),
  caption: z.string().optional(),
  headers: z.array(z.string()).optional(),
  rows: z.array(TableRow).min(1),
});

// ============================================================================
// ALL NON-CONTAINER NODES
// ============================================================================

/** All non-container UI nodes */
const UINodeBase = z.discriminatedUnion('type', [
  // Text/Display
  HeadingNode,
  ParagraphNode,
  TextNode,
  AlertNode,
  BadgeNode,
  ProgressNode,
  SeparatorNode,
  // Interactive
  ButtonNode,
  InputNode,
  TextareaNode,
  CheckboxNode,
  SwitchNode,
  RadioGroupNode,
  SelectNode,
  // Navigation
  BreadcrumbNode,
  NavigationMenuNode,
  PaginationNode,
  // Data
  TableNode,
]);

// ============================================================================
// CONTAINER COMPONENTS (with children) - Use explicit types to avoid circular refs
// ============================================================================

// Define the UINode type explicitly to break the circular reference
type BaseUINode = z.infer<typeof UINodeBase>;

interface CardNodeType {
  type: 'card';
  title?: string;
  description?: string;
  children: UINodeType[];
}

interface AccordionItemType {
  title: string;
  content: UINodeType[];
  defaultOpen?: boolean;
}

interface AccordionNodeType {
  type: 'accordion';
  items: AccordionItemType[];
  multiple?: boolean;
}

interface TabItemType {
  id: string;
  label: string;
  content: UINodeType[];
}

interface TabsNodeType {
  type: 'tabs';
  items: TabItemType[];
  defaultTab?: string;
}

interface ScrollAreaNodeType {
  type: 'scrollArea';
  maxHeight?: string;
  children: UINodeType[];
}

export type UINodeType = BaseUINode | CardNodeType | AccordionNodeType | TabsNodeType | ScrollAreaNodeType;

// Runtime schemas using z.lazy for proper parsing
const UINodeLazy: z.ZodType<UINodeType> = z.lazy(() =>
  z.union([
    UINodeBase,
    z.object({
      type: z.literal('card'),
      title: z.string().optional(),
      description: z.string().optional(),
      children: z.array(UINodeLazy),
    }),
    z.object({
      type: z.literal('accordion'),
      items: z.array(z.object({
        title: z.string(),
        content: z.array(UINodeLazy),
        defaultOpen: z.boolean().optional(),
      })).min(1),
      multiple: z.boolean().optional(),
    }),
    z.object({
      type: z.literal('tabs'),
      items: z.array(z.object({
        id: z.string(),
        label: z.string(),
        content: z.array(UINodeLazy),
      })).min(1),
      defaultTab: z.string().optional(),
    }),
    z.object({
      type: z.literal('scrollArea'),
      maxHeight: z.string().optional(),
      children: z.array(UINodeLazy),
    }),
  ])
);

/** Export the UINode schema */
export const UINode = UINodeLazy;
export type UINode = UINodeType;

// ============================================================================
// ROOT SCHEMA
// ============================================================================

/** The complete accessible UI structure */
export const AccessibleUI = z.object({
  /** Title of the accessible view */
  title: z.string(),
  /** Brief description of the page */
  description: z.string().optional(),
  /** The UI nodes to render */
  nodes: z.array(UINode),
});

export type AccessibleUI = z.infer<typeof AccessibleUI>;

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Parse and validate an AccessibleUI object from unknown data
 */
export function parseAccessibleUI(data: unknown): AccessibleUI {
  return AccessibleUI.parse(data);
}

/**
 * Safely parse an AccessibleUI object, returning null on failure
 */
export function safeParseAccessibleUI(data: unknown): AccessibleUI | null {
  const result = AccessibleUI.safeParse(data);
  return result.success ? result.data : null;
}

/**
 * Get the JSON schema description for LLM prompting
 */
export function getSchemaDescription(): string {
  return `
The accessible UI is defined as a JSON object with this structure:

{
  "title": "Page title (required)",
  "description": "Brief page description (optional)",
  "nodes": [/* array of UI nodes */]
}

Available node types:

TEXT/DISPLAY:
- heading: { type: "heading", level: 1-6, text: "..." }
- paragraph: { type: "paragraph", text: "..." }
- text: { type: "text", text: "...", bold?: boolean, italic?: boolean }
- alert: { type: "alert", variant?: "default"|"destructive", title?: "...", description: "..." }
- badge: { type: "badge", text: "...", variant?: "default"|"secondary"|"destructive"|"outline" }
- progress: { type: "progress", value: 0-100, label?: "..." }
- separator: { type: "separator", orientation?: "horizontal"|"vertical" }

INTERACTIVE (include actionBinding to link to real page elements):
- button: { type: "button", label: "...", variant?: "default"|"secondary"|"outline"|"destructive"|"ghost"|"link", actionBinding?: { elementId: "...", action: "click" } }
- input: { type: "input", label: "...", placeholder?: "...", inputType?: "text"|"email"|"password"|"number"|"tel"|"url"|"search", actionBinding?: {...} }
- textarea: { type: "textarea", label: "...", placeholder?: "...", rows?: number, actionBinding?: {...} }
- checkbox: { type: "checkbox", label: "...", checked?: boolean, actionBinding?: {...} }
- switch: { type: "switch", label: "...", checked?: boolean, actionBinding?: {...} }
- radioGroup: { type: "radioGroup", label: "...", options: [{ value: "...", label: "..." }], actionBinding?: {...} }
- select: { type: "select", label: "...", options: [{ value: "...", label: "..." }], actionBinding?: {...} }

NAVIGATION:
- breadcrumb: { type: "breadcrumb", items: [{ label: "...", href?: "...", actionBinding?: {...} }] }
- navigationMenu: { type: "navigationMenu", items: [{ label: "...", href?: "...", active?: boolean, actionBinding?: {...} }] }
- pagination: { type: "pagination", currentPage: number, totalPages: number, actionBinding?: {...} }

DATA:
- table: { type: "table", caption?: "...", headers?: ["..."], rows: [{ cells: [{ content: "..." }] }] }

CONTAINERS (can nest other nodes):
- card: { type: "card", title?: "...", description?: "...", children: [/* nodes */] }
- accordion: { type: "accordion", items: [{ title: "...", content: [/* nodes */] }], multiple?: boolean }
- tabs: { type: "tabs", items: [{ id: "...", label: "...", content: [/* nodes */] }], defaultTab?: "..." }
- scrollArea: { type: "scrollArea", maxHeight?: "300px", children: [/* nodes */] }

IMPORTANT for actionBinding:
- Use the elementId from the scanned actions to link UI elements to real page elements
- When the user interacts with a bound element, it will trigger the action on the real page
- Only add actionBinding when there's a corresponding action from the page scan
`.trim();
}
