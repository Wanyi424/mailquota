export type Session = {
  username: string;
  csrf_token: string;
};

export type Customer = {
  customer_id: string;
  name: string;
  from_name: string;
  subject: string;
  reply_to: string;
  text_template: string;
  html_template: string;
  enabled: boolean;
  quota_total: number;
  used_count: number;
  reserved_count: number;
  available_count: number;
  version: number;
  api_key_mask?: string;
  api_key?: string;
};

export type CustomerPage = {
  total: number;
  page: number;
  page_size: number;
  items: Customer[];
};

export type Template = {
  html: string;
  version: number;
};

export type RequestRow = {
  id: number;
  customer_id: string;
  request_id: string;
  email: string;
  client_ip: string;
  status: 'accepted' | 'pending' | 'unknown' | 'failed';
  created_at: number;
  updated_at: number;
  provider_message_id: string | null;
  error_code: string | null;
  error_detail: string | null;
  resolved_at: number | null;
  resolved_by: string | null;
  resolution_note: string | null;
};

export type RequestPage = {
  total: number;
  page: number;
  page_size: number;
  items: RequestRow[];
};

export type RequestFilters = {
  page?: number;
  page_size?: number;
  customer_id?: string;
  status?: string;
  email?: string;
  from?: number;
  to?: number;
};

export type Crumb = {
  label: string;
  to?: string;
};

export type AdminApi = {
  session: () => Promise<Session>;
  login: (username: string, password: string) => Promise<Session>;
  logout: () => Promise<void>;
  customers: (page?: number, pageSize?: number) => Promise<CustomerPage>;
  customer: (id: string) => Promise<Customer>;
  createCustomer: (body: Record<string, unknown>) => Promise<Customer>;
  rename: (id: string, version: number, name: string) => Promise<Customer>;
  setEnabled: (id: string, version: number, enabled: boolean) => Promise<Customer>;
  resetKey: (id: string, version: number) => Promise<Customer>;
  setQuota: (id: string, version: number, quotaTotal: number) => Promise<Customer>;
  saveMail: (id: string, version: number, body: { from_name: string; subject: string; reply_to: string; text_template: string }) => Promise<Customer>;
  template: (id: string) => Promise<Template>;
  saveTemplate: (id: string, version: number, html: string) => Promise<{ version: number }>;
  preview: (html: string) => Promise<string>;
  requests: (filters: RequestFilters) => Promise<RequestPage>;
  resolve: (id: number, status: 'accepted' | 'failed', note: string) => Promise<RequestRow>;
};
