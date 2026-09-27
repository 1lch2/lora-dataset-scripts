import { useQuery } from '@tanstack/react-query';
import { getSessionInfo } from '../api/client';
import { ReviewPage } from '../Pages/review/ReviewPage';

export function App() {
  const session = useQuery({ queryKey: ['session'], queryFn: getSessionInfo, staleTime: Infinity });
  if (session.isPending)
    return (
      <p className='p-4 text-review-muted' role='status'>
        读取进度…
      </p>
    );
  if (session.error)
    return (
      <p className='p-4' role='alert'>
        {session.error.message}
        <button onClick={() => void session.refetch()}>刷新</button>
      </p>
    );
  return <ReviewPage session={session.data} />;
}
