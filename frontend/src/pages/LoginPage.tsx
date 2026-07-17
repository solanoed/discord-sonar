import { useSearchParams } from 'react-router-dom';
import { getLoginUrl } from '../services/apiClient';

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const error = searchParams.get('error');

  return (
    <div>
      <h1>Discord Music Dashboard</h1>
      {error ? <p role="alert">Login failed. Please try again.</p> : null}
      <a href={getLoginUrl()}>Login with Discord</a>
    </div>
  );
}
