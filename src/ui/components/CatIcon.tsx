import { categoryStyle } from '../categoryStyle'
import { Icon } from './common'

/** Rounded tinted tile with the category's icon; the same name always gets the same look. */
export function CatIcon({ name, size = 40 }: { name: string; size?: number }) {
  const st = categoryStyle(name)
  return (
    <span className="cat-icon" style={{ '--c': st.color, width: size, height: size } as React.CSSProperties} aria-hidden="true">
      {st.image
        ? <img src={`${import.meta.env.BASE_URL}icons/${st.image}`} alt="" width={Math.round(size * 0.78)} height={Math.round(size * 0.78)} decoding="async" />
        : <Icon name={st.icon} size={Math.round(size * 0.5)} />}
    </span>
  )
}
