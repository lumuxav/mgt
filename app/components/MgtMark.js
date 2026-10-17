import Image from 'next/image'

export default function MgtMark({ className = '' }) {
  return <Image src="/icon.svg?v=2" alt="MGT" width={64} height={64} className={`shrink-0 rounded-2xl ${className}`} unoptimized />
}
