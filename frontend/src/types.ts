export type MoneyBreakdown = {
  total: number;
  principal: number;
  interest: number;
  other: number;
};

export type Projection = {
  status: "paid" | "calculated" | "needs_input" | "insufficient_payment";
  monthly_payment: number | null;
  months: number | null;
  total: number | null;
  interest: number | null;
  confidence: "high" | "medium" | "low";
  rate_source?: string;
  message?: string;
};

export type Contract = {
  id: string;
  creditor: string;
  status: "active" | "closed";
  status_label: string;
  deal_date: string | null;
  end_date: string | null;
  initial_amount: number | null;
  balance: MoneyBreakdown;
  paid: MoneyBreakdown;
  rates: { nominal: number | null; psk: number | null };
  payments: {
    average: number | null;
    minimum: number | null;
    next: number | null;
    remaining_total: number | null;
  };
  actual_payment_dates: string[];
  actual_payment_count: number;
  payment_count_confidence: "high" | "low";
  has_overdue_history: boolean;
  projection: Projection | null;
};

export type LowPaymentRisk = {
  contract_id: string;
  creditor: string;
  payment_count: number;
  confidence: "high" | "low";
  balance: number;
  status: "active" | "closed";
  severity: "high" | "medium";
};

export type Analysis = {
  report: {
    provider: string;
    provider_label: string;
    version: string | null;
    generated_at: string;
    customer_name: string | null;
  };
  summary: {
    active_count: number;
    closed_count: number;
    reported_active_count: number | null;
    reported_total_debt: number | null;
    calculated_total_debt: number;
    debt_difference: number | null;
    paid: MoneyBreakdown;
    bank_projection: {
      monthly_payment: number;
      months: number;
      total: number | null;
      interest: number | null;
      unresolved_contracts: number;
      confidence: "high" | "medium" | "low";
    };
  };
  contracts: Contract[];
  compliance: {
    low_payment_contracts: LowPaymentRisk[];
    proximity_groups: Array<{
      contract_ids: string[];
      creditors: string[];
      start_date: string;
      days_window: number;
    }>;
    large_low_payment_contracts: LowPaymentRisk[];
    large_debt_threshold: number;
    requires_legal_review: boolean;
  };
  warnings: string[];
};

export type ScenarioSettings = {
  bflCost: number;
  bflMonths: number;
  rdgCost: number;
  rdgMonths: number;
  bankMonthly: number | null;
  bankMonths: number | null;
  largeDebtThreshold: number;
};
