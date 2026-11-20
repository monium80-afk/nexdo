type CustomerInfo = { entitlements: { active: Record<string, object> } };

const customerInfo: CustomerInfo = {
  entitlements: { active: { nexdo_pro: { periodType: "NORMAL", willRenew: true, expirationDate: null } } },
};

export const purchasesTestState = {
  appUserId: "anonymous",
  identifyFailure: null as Error | null,
  purchaseCalls: 0,
  restoreCalls: 0,
};

const Purchases = {
  setLogLevel: async (_level: unknown) => {},
  configure: (_options: { apiKey: string }) => {},
  addCustomerInfoUpdateListener: (_listener: (info: CustomerInfo) => void) => {},
  removeCustomerInfoUpdateListener: (_listener: (info: CustomerInfo) => void) => {},
  getAppUserID: async () => {
    if (purchasesTestState.identifyFailure) throw purchasesTestState.identifyFailure;
    return purchasesTestState.appUserId;
  },
  logIn: async (userId: string) => {
    if (purchasesTestState.identifyFailure) throw purchasesTestState.identifyFailure;
    purchasesTestState.appUserId = userId;
    return { customerInfo };
  },
  getCustomerInfo: async () => customerInfo,
  isAnonymous: async () => purchasesTestState.appUserId === "anonymous",
  logOut: async () => {
    purchasesTestState.appUserId = "anonymous";
    return customerInfo;
  },
  purchasePackage: async (_plan: unknown) => {
    purchasesTestState.purchaseCalls += 1;
    return { customerInfo };
  },
  restorePurchases: async () => {
    purchasesTestState.restoreCalls += 1;
    return customerInfo;
  },
};

export const INTRO_ELIGIBILITY_STATUS = { INTRO_ELIGIBILITY_STATUS_ELIGIBLE: 0 };
export const LOG_LEVEL = { INFO: 0, WARN: 1 };
export const PURCHASES_ERROR_CODE = {
  NETWORK_ERROR: "NETWORK_ERROR",
  OFFLINE_CONNECTION_ERROR: "OFFLINE_CONNECTION_ERROR",
  PURCHASE_CANCELLED_ERROR: "PURCHASE_CANCELLED_ERROR",
  PAYMENT_PENDING_ERROR: "PAYMENT_PENDING_ERROR",
  PRODUCT_ALREADY_PURCHASED_ERROR: "PRODUCT_ALREADY_PURCHASED_ERROR",
};

export default Purchases;
