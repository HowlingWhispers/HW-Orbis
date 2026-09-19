import { Link } from 'react-router-dom';
import { useSEO } from '../hooks/useSEO';

export function NotFoundView() {
  useSEO({
    title: 'Page Not Found | Orbis — Library of Howling Whispers',
    description: 'The page you are looking for does not exist in Orbis, the Library of Howling Whispers.',
    canonicalPath: '/404',
    noindex: true,
    nofollow: true,
  });

  return <div className="page not-found"><span>404</span><h1>This shelf does not exist.</h1><p>The trail ends here, but Orbis is still close.</p><Link className="button button--primary" to="/">Return to Orbis</Link></div>;
}
