import { colors } from "@/constants/theme";
import type { Category, CategoryColor } from "@/types/category";
import type { BuiltInCategoryId } from "@/types/task";

export const CATEGORY_COLORS = colors.category;

// Every swatch a category can use, in the order the color picker shows them.
export const CATEGORY_COLOR_OPTIONS: { value: CategoryColor; label: string }[] = [
  { value: "terracotta", label: "Terracotta" },
  { value: "ocean", label: "Ocean" },
  { value: "sage", label: "Sage" },
  { value: "warm", label: "Warm" },
  { value: "indigo", label: "Indigo" },
  { value: "dusk", label: "Dusk" },
  { value: "teal", label: "Teal" },
  { value: "slate", label: "Slate" },
];

/** A swatch's colors — falls back to Slate for a color name this build doesn't know. */
export function getCategoryTint(color: string): { 500: string; 100: string } {
  return CATEGORY_COLORS[color as CategoryColor] ?? CATEGORY_COLORS.slate;
}

// Where orphaned tasks go first, when it still exists.
export const FALLBACK_CATEGORY_ID: BuiltInCategoryId = "other";

// What every account starts with (and what "Reset defaults" restores).
export const DEFAULT_CATEGORIES: (Category & { id: BuiltInCategoryId })[] = [
  { id: "school", label: "School", color: "terracotta" },
  { id: "work", label: "Work", color: "ocean" },
  { id: "personal", label: "Personal", color: "sage" },
  { id: FALLBACK_CATEGORY_ID, label: "Other", color: "slate" },
];

export const DEFAULT_CATEGORY_ID: BuiltInCategoryId = "personal";

export function isBuiltInCategoryId(id: string): id is BuiltInCategoryId {
  return DEFAULT_CATEGORIES.some((category) => category.id === id);
}

/** "Other" always exists and can't be renamed or recolored, so Settings leaves it out. */
export function isEditableCategoryId(id: string): boolean {
  return id !== FALLBACK_CATEGORY_ID;
}

/**
 * The id a task should use for `id`: itself if that category still exists,
 * otherwise "Other", otherwise the first category left.
 */
export function resolveCategoryId(categories: Category[], id: string | undefined): string {
  if (id && categories.some((category) => category.id === id)) return id;
  if (categories.some((category) => category.id === FALLBACK_CATEGORY_ID)) return FALLBACK_CATEGORY_ID;
  return categories[0]?.id ?? FALLBACK_CATEGORY_ID;
}

export function findCategory(categories: Category[], id: string): Category {
  const resolvedId = resolveCategoryId(categories, id);
  return (
    categories.find((category) => category.id === resolvedId) ??
    DEFAULT_CATEGORIES[DEFAULT_CATEGORIES.length - 1]
  );
}
