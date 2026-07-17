import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LoginPage } from './LoginPage';

describe('LoginPage', () => {
  it('shows a login link pointing at the backend login route', () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <LoginPage />
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: /login with discord/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('/api/auth/login'));
  });

  it('does not show an error message with no error query param', () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <LoginPage />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows an error message when the URL has an error query param', () => {
    render(
      <MemoryRouter initialEntries={['/login?error=oauth_failed']}>
        <LoginPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
