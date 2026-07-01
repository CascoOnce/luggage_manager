import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef } from 'react'
import { MdVisibility, MdVisibilityOff, MdRestore } from 'react-icons/md'

const DraggableWidget = forwardRef(({ children, style, containerRef }, ref) => {
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [isVisible, setIsVisible] = useState(true)
  const [isHovered, setIsHovered] = useState(false)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const widgetRef = useRef(null)

  useImperativeHandle(ref, () => ({
    resetPosition: () => setDragOffset({ x: 0, y: 0 }),
    toggleVisibility: () => setIsVisible(v => !v),
    setVisibility: (v) => setIsVisible(v),
  }))

  const handleMouseDown = (e) => {
    // Only drag if left click and not clicking a button
    if (e.button !== 0 || e.target.closest('button')) return
    setIsDragging(true)
    dragStartRef.current = { x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y }
  }

  useEffect(() => {
    if (!isDragging) return
    const handleMouseMove = (e) => {
      let newX = e.clientX - dragStartRef.current.x
      let newY = e.clientY - dragStartRef.current.y

      if (containerRef?.current && widgetRef.current) {
        const containerRect = containerRef.current.getBoundingClientRect()
        const widgetRect = widgetRef.current.getBoundingClientRect()
        
        // Calculate the base position of the widget before any drag offset
        const baseRect = {
          left: widgetRect.left - dragOffset.x,
          top: widgetRect.top - dragOffset.y,
          right: widgetRect.right - dragOffset.x,
          bottom: widgetRect.bottom - dragOffset.y,
        }

        // Calculate limits
        const minX = containerRect.left - baseRect.left
        const maxX = containerRect.right - baseRect.right
        const minY = containerRect.top - baseRect.top
        const maxY = containerRect.bottom - baseRect.bottom

        newX = Math.max(minX, Math.min(newX, maxX))
        newY = Math.max(minY, Math.min(newY, maxY))
      }

      setDragOffset({ x: newX, y: newY })
    }
    const handleMouseUp = () => setIsDragging(false)
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, containerRef, dragOffset])

  if (!isVisible) return null

  return (
    <div
      ref={widgetRef}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        ...style,
        transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)`,
        cursor: isDragging ? 'grabbing' : 'grab',
        pointerEvents: 'auto',
        position: 'relative',
      }}
    >
      {children}
      <div style={{
        position: 'absolute',
        top: 4,
        right: 4,
        display: 'flex',
        gap: 4,
        opacity: isHovered || isDragging ? 1 : 0,
        transition: 'opacity 0.2s',
      }}>
        <button
          onClick={() => setDragOffset({ x: 0, y: 0 })}
          style={{
            background: 'rgba(0,0,0,0.6)',
            border: 'none',
            borderRadius: 4,
            color: 'white',
            cursor: 'pointer',
            padding: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          title="Restaurar posición"
        >
          <MdRestore size={14} />
        </button>
        <button
          onClick={() => setIsVisible(false)}
          style={{
            background: 'rgba(0,0,0,0.6)',
            border: 'none',
            borderRadius: 4,
            color: 'white',
            cursor: 'pointer',
            padding: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          title="Ocultar"
        >
          <MdVisibilityOff size={14} />
        </button>
      </div>
    </div>
  )
})

export default DraggableWidget
