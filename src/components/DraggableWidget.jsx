import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef } from 'react'
import { MdVisibility, MdVisibilityOff, MdRestore } from 'react-icons/md'

const DraggableWidget = forwardRef(({ children, style, containerRef, hideVisibilityToggle = false }, ref) => {
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [isVisible, setIsVisible] = useState(true)
  const [isHovered, setIsHovered] = useState(false)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const limitsRef = useRef({ minX: -Infinity, maxX: Infinity, minY: -Infinity, maxY: Infinity })
  const hasDraggedRef = useRef(false)
  const prevBaseRectRef = useRef(null)
  const anchorYRef = useRef('bottom') // default anchor
  const widgetRef = useRef(null)

  useImperativeHandle(ref, () => ({
    resetPosition: () => {
      setDragOffset({ x: 0, y: 0 })
      hasDraggedRef.current = false
      prevBaseRectRef.current = null
      anchorYRef.current = 'bottom'
    },
    toggleVisibility: () => setIsVisible(v => !v),
    setVisibility: (v) => setIsVisible(v),
  }))

  useEffect(() => {
    const handleRestore = () => {
      setDragOffset({ x: 0, y: 0 })
      hasDraggedRef.current = false
      prevBaseRectRef.current = null
      anchorYRef.current = 'bottom'
      setIsVisible(true)
    }
    window.addEventListener('restoreWidgets', handleRestore)
    return () => window.removeEventListener('restoreWidgets', handleRestore)
  }, [])

  const handleMouseDown = (e) => {
    // Only drag if left click and not clicking a button
    if (e.button !== 0 || e.target.closest('button')) return
    setIsDragging(true)
    dragStartRef.current = { x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y }
    hasDraggedRef.current = true

    // Calculate limits ONCE at the start of the drag
    if (containerRef?.current && widgetRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect()
      const widgetRect = widgetRef.current.getBoundingClientRect()
      
      const baseRect = {
        left: widgetRect.left - dragOffset.x,
        top: widgetRect.top - dragOffset.y,
        right: widgetRect.right - dragOffset.x,
        bottom: widgetRect.bottom - dragOffset.y,
      }

      limitsRef.current = {
        minX: containerRect.left - baseRect.left,
        maxX: containerRect.right - baseRect.right,
        minY: containerRect.top - baseRect.top,
        maxY: containerRect.bottom - baseRect.bottom,
      }
    } else {
      limitsRef.current = { minX: -Infinity, maxX: Infinity, minY: -Infinity, maxY: Infinity }
    }
  }

  useEffect(() => {
    if (!isDragging) return
    const handleMouseMove = (e) => {
      // If we actually move the mouse, we are dragging. Reset the baseline so the next resize uses the new position.
      if (prevBaseRectRef.current) {
        prevBaseRectRef.current = null
      }

      let newX = e.clientX - dragStartRef.current.x
      let newY = e.clientY - dragStartRef.current.y

      const { minX, maxX, minY, maxY } = limitsRef.current
      newX = Math.max(minX, Math.min(newX, maxX))
      newY = Math.max(minY, Math.min(newY, maxY))

      setDragOffset({ x: newX, y: newY })
    }
    const handleMouseUp = () => {
      setIsDragging(false)
      if (containerRef?.current && widgetRef.current) {
        const containerRect = containerRef.current.getBoundingClientRect()
        const widgetRect = widgetRef.current.getBoundingClientRect()
        const midY = containerRect.top + containerRect.height / 2
        const widgetMidY = widgetRect.top + widgetRect.height / 2
        anchorYRef.current = widgetMidY < midY ? 'top' : 'bottom'
      }
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, containerRef])

  useEffect(() => {
    if (!containerRef?.current || !widgetRef.current || isDragging) return
    const observer = new ResizeObserver(() => {
      const containerRect = containerRef.current.getBoundingClientRect()
      const widgetRect = widgetRef.current.getBoundingClientRect()
      
      const baseRect = {
        left: widgetRect.left - dragOffset.x,
        top: widgetRect.top - dragOffset.y,
        right: widgetRect.right - dragOffset.x,
        bottom: widgetRect.bottom - dragOffset.y,
      }

      let nextX = dragOffset.x
      let nextY = dragOffset.y

      if (hasDraggedRef.current && prevBaseRectRef.current) {
        let deltaY = 0
        if (anchorYRef.current === 'top') {
          deltaY = baseRect.top - prevBaseRectRef.current.top
        } else {
          deltaY = baseRect.bottom - prevBaseRectRef.current.bottom
        }
        
        const deltaX = baseRect.left - prevBaseRectRef.current.left
        
        if (Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5) {
          nextX -= deltaX
          nextY -= deltaY
        }
      }

      const minX = containerRect.left - baseRect.left
      const maxX = containerRect.right - baseRect.right
      const minY = containerRect.top - baseRect.top
      const maxY = containerRect.bottom - baseRect.bottom

      nextX = Math.max(minX, Math.min(nextX, maxX))
      nextY = Math.max(minY, Math.min(nextY, maxY))

      if (nextX !== dragOffset.x || nextY !== dragOffset.y) {
        setDragOffset({ x: nextX, y: nextY })
      }
      
      prevBaseRectRef.current = baseRect
    })
    
    observer.observe(widgetRef.current)
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [dragOffset, isDragging, containerRef])

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
        {!hideVisibilityToggle && (
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
        )}
      </div>
    </div>
  )
})

export default DraggableWidget
