import Image from 'next/image'

export default function MgtMark({ className = '' }) {
  return <Image src="/icons/mgt-icon-512.png?v=4" alt="MGT" width={64} height={64} className={`shrink-0 rounded-full ${className}`} unoptimized />
}
