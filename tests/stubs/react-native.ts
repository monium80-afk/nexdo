// The slice of react-native the stores touch, for running them under Node.
type Scheme = "light" | "dark" | "unspecified";

let scheme: Scheme = "unspecified";
const listeners = new Set<(event: { colorScheme: Scheme }) => void>();

export const Platform = {
  OS: "ios" as string,
  select<T>(options: { ios?: T; android?: T; default?: T }): T | undefined {
    return options.ios ?? options.default;
  },
};

export const Appearance = {
  getColorScheme: () => (scheme === "unspecified" ? "light" : scheme),
  setColorScheme: (next: Scheme) => {
    scheme = next;
    listeners.forEach((listener) => listener({ colorScheme: next }));
  },
  addChangeListener: (listener: (event: { colorScheme: Scheme }) => void) => {
    listeners.add(listener);
    return { remove: () => listeners.delete(listener) };
  },
};

export const useColorScheme = () => Appearance.getColorScheme();

export default { Platform, Appearance };
