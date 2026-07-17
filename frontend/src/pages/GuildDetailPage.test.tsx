import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { GuildDetailPage } from './GuildDetailPage';

describe('GuildDetailPage', () => {
  it('shows the guild id from the URL', () => {
    render(
      <MemoryRouter initialEntries={['/guilds/guild-1']}>
        <Routes>
          <Route path="/guilds/:guildId" element={<GuildDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText(/guild-1/)).toBeInTheDocument();
  });
});
