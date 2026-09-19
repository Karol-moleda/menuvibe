import { translateAuthError } from './auth.service';

describe('translateAuthError', () => {
  it('tłumaczy złe dane logowania', () => {
    expect(translateAuthError('Invalid login credentials')).toBe('Nieprawidłowy e-mail lub hasło.');
  });
  it('tłumaczy brak sieci', () => {
    expect(translateAuthError('Failed to fetch')).toContain('Brak połączenia');
  });
  it('zostawia nieznane komunikaty', () => {
    expect(translateAuthError('coś innego')).toBe('coś innego');
  });
});
