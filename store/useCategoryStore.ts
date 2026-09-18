import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
    DEFAULT_CATEGORIES,
    DEFAULT_CATEGORY_ID,
    findCategory,
    isBuiltInCategoryId,
    isEditableCategoryId,
    resolveCategoryId,
} from "@/constants/categories";
import { ALL_TRANSLATIONS, getTranslations, translate } from "@/lib/i18n";
import { useTaskStore } from "@/store/useTaskStore";
import type { AppLanguage } from "@/types/settings";
import type { Category, CategoryColor } from "@/types/category";

/** The built-in categories, named in the current app language. */
function defaultCategories(): Category[] {
  const labels = translate().categories.defaults;
  return DEFAULT_CATEGORIES.map((category) => ({ ...category, label: labels[category.id] }));
}

function createCategoryId(): string {
  return `category-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// Tasks can't point at a category that no longer exists — move them.
function moveOrphanedTasks(categories: Category[]) {
  const { tasks, updateTask } = useTaskStore.getState();
  tasks
    .filter((task) => !categories.some((category) => category.id === task.category))
    .forEach((task) => updateTask(task.id, { category: resolveCategoryId(categories, undefined) }));
}

type CategoryStore = {
  categories: Category[];
  /** Pre-selected for new tasks — the starred category in Manage Categories. */
  defaultCategoryId: string;
  /** Returns the new category's id, or undefined when the label is empty. */
  addCategory: (label: string, color: CategoryColor) => string | undefined;
  /** "Other" can't be renamed or recolored. */
  updateCategory: (id: string, changes: Pick<Category, "label" | "color">) => void;
  /** The last remaining category can't be deleted; a deleted category's tasks move to "Other". */
  deleteCategory: (id: string) => void;
  setDefaultCategory: (id: string) => void;
  resetDefaults: () => void;
  /** Renames built-in categories into a new app language — unless the user renamed them. */
  relabelDefaults: (language: AppLanguage) => void;
};

export const useCategoryStore = create<CategoryStore>()(
  persist(
    (set, get) => ({
      categories: DEFAULT_CATEGORIES,
      defaultCategoryId: DEFAULT_CATEGORY_ID,

      addCategory: (label, color) => {
        const trimmed = label.trim();
        if (!trimmed) return undefined;
        const id = createCategoryId();
        set((state) => ({ categories: [...state.categories, { id, label: trimmed, color }] }));
        return id;
      },

      updateCategory: (id, changes) => {
        const label = changes.label.trim();
        if (!label || !isEditableCategoryId(id)) return;
        set((state) => ({
          categories: state.categories.map((category) =>
            category.id === id ? { ...category, label, color: changes.color } : category,
          ),
        }));
      },

      deleteCategory: (id) => {
        const { categories, defaultCategoryId } = get();
        if (categories.length <= 1 || isBuiltInCategoryId(id)) return;
        const remaining = categories.filter((category) => category.id !== id);
        set({
          categories: remaining,
          defaultCategoryId: defaultCategoryId === id ? resolveCategoryId(remaining, undefined) : defaultCategoryId,
        });
        moveOrphanedTasks(remaining);
      },

      setDefaultCategory: (id) => set({ defaultCategoryId: id }),

      resetDefaults: () => {
        const categories = defaultCategories();
        set({ categories, defaultCategoryId: DEFAULT_CATEGORY_ID });
        moveOrphanedTasks(categories);
      },

      relabelDefaults: (language) => {
        const labels = getTranslations(language).categories.defaults;
        set((state) => ({
          categories: state.categories.map((category) => {
            const id = category.id;
            if (!isBuiltInCategoryId(id)) return category;
            // Still named exactly as the app named it in some language → it's safe to rename.
            const isUntouched = ALL_TRANSLATIONS.some((t) => t.categories.defaults[id] === category.label);
            return isUntouched ? { ...category, label: labels[id] } : category;
          }),
        }));
      },
    }),
    {
      name: "nexdo-categories",
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

/** Reactive lookup for components — re-renders when the category is renamed or recolored. */
export function useCategory(id: string): Category {
  const categories = useCategoryStore((state) => state.categories);
  return findCategory(categories, id);
}
