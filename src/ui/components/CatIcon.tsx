import { categoryStyle } from '../categoryStyle'
import { Icon } from './common'

/** Rounded tinted tile with the category's icon; the same name always gets the same look. */
export function CatIcon({ name, size = 40 }: { name: string; size?: number }) {
  const st = categoryStyle(name)
  return (
    <span className="cat-icon" style={{ '--c': st.color, width: size, height: size } as React.CSSProperties} aria-hidden="true">
      <Icon name={st.icon} size={Math.round(size * 0.5)} />
    </span>
  )
}
