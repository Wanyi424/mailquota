import { useEffect } from 'react';

/** 浏览器标签页标题：多开几个标签时能分清哪个是哪个。 */
export function useTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · MailQuota`;
  }, [title]);
}
