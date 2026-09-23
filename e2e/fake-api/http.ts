/** A tiny request/response model shared by the fake services. */
export interface FakeRequest {
    method: string;
    url: URL;
    headers: Record<string, string | undefined>;
    body: string;
}

export interface FakeResponse {
    status: number;
    headers?: Record<string, string>;
    body?: string;
}

export function json(value: unknown, status = 200, headers: Record<string, string> = {}): FakeResponse {
    return {
        status,
        headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
        body: JSON.stringify(value)
    };
}

export function text(value: string, status = 200, headers: Record<string, string> = {}): FakeResponse {
    return { status, headers: { "Content-Type": "text/plain; charset=utf-8", ...headers }, body: value };
}

export function html(value: string, status = 200): FakeResponse {
    return { status, headers: { "Content-Type": "text/html; charset=utf-8" }, body: value };
}

export function bearer(request: FakeRequest): string | undefined {
    const header = request.headers.authorization ?? "";
    const match = /^(?:Bearer|token)\s+(.+)$/i.exec(header);
    return match?.[1];
}

export function formBody(request: FakeRequest): URLSearchParams {
    return new URLSearchParams(request.body);
}

export function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}
