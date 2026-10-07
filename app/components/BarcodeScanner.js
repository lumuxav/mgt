'use client'

import { useEffect,useRef,useState } from 'react'

const FORMATS=['ean_13','ean_8','upc_a','upc_e','code_128','code_39','code_93','codabar','itf','qr_code']

export default function BarcodeScanner({onScan,label='Scan barcode',className=''}) {
  const videoRef=useRef(null)
  const streamRef=useRef(null)
  const frameRef=useRef(null)
  const detectorRef=useRef(null)
  const [open,setOpen]=useState(false)
  const [manual,setManual]=useState('')
  const [status,setStatus]=useState('')
  const [supported,setSupported]=useState(true)

  const stop=()=>{
    if(frameRef.current)cancelAnimationFrame(frameRef.current)
    frameRef.current=null
    if(streamRef.current){
      for(const track of streamRef.current.getTracks())track.stop()
      streamRef.current=null
    }
    if(videoRef.current)videoRef.current.srcObject=null
  }

  const close=()=>{
    stop()
    setOpen(false)
    setStatus('')
    setManual('')
  }

  const commit=value=>{
    const code=String(value||'').trim()
    if(!code)return
    onScan?.(code)
    close()
  }

  useEffect(()=>{
    if(!open)return
    let cancelled=false

    const begin=async()=>{
      try{
        if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera access is not supported on this device.')

        let detector=null
        if('BarcodeDetector' in window){
          try{
            const available=await window.BarcodeDetector.getSupportedFormats?.()
            const formats=Array.isArray(available)&&available.length?FORMATS.filter(f=>available.includes(f)):FORMATS
            detector=new window.BarcodeDetector({formats:formats.length?formats:undefined})
            detectorRef.current=detector
          }catch{
            detector=null
          }
        }

        setSupported(Boolean(detector))
        const stream=await navigator.mediaDevices.getUserMedia({
          audio:false,
          video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},
        })
        if(cancelled){
          stream.getTracks().forEach(track=>track.stop())
          return
        }
        streamRef.current=stream
        if(videoRef.current){
          videoRef.current.srcObject=stream
          await videoRef.current.play()
        }

        if(!detector){
          setStatus('Camera opened. Automatic barcode detection is not available in this browser; enter the code below or use a USB/Bluetooth scanner.')
          return
        }

        setStatus('Point the camera at the barcode.')
        const scan=async()=>{
          if(cancelled||!videoRef.current||!detectorRef.current)return
          try{
            if(videoRef.current.readyState>=2){
              const codes=await detectorRef.current.detect(videoRef.current)
              const raw=codes?.[0]?.rawValue
              if(raw)return commit(raw)
            }
          }catch{}
          frameRef.current=requestAnimationFrame(scan)
        }
        scan()
      }catch(error){
        setSupported(false)
        setStatus(error?.message||'Could not open the camera. Enter the barcode manually below.')
      }
    }

    begin()
    return()=>{
      cancelled=true
      stop()
    }
  },[open])

  return <>
    <button type="button" onClick={()=>setOpen(true)} className={className||'btn-secondary rounded-xl px-3 py-2.5 text-sm font-black'}>
      {label}
    </button>

    {open&&<div className="barcode-modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)close()}}>
      <section className="barcode-modal" role="dialog" aria-modal="true" aria-label="Barcode scanner">
        <div className="flex items-start justify-between gap-3">
          <div><p className="page-eyebrow">Camera scanner</p><h2 className="text-xl font-black">Scan barcode</h2></div>
          <button type="button" onClick={close} className="barcode-close" aria-label="Close scanner">×</button>
        </div>

        <div className="barcode-camera mt-4">
          <video ref={videoRef} muted playsInline />
          <div className="barcode-frame" aria-hidden="true"/>
        </div>

        <p className="mt-3 text-xs leading-5 text-muted">{status||'Starting camera…'}</p>

        {!supported&&<form className="mt-4 flex gap-2" onSubmit={event=>{event.preventDefault();commit(manual)}}>
          <input autoFocus className="input-base" value={manual} onChange={event=>setManual(event.target.value)} placeholder="Enter barcode / SKU manually"/>
          <button className="btn-primary rounded-xl px-4 py-2 text-sm font-black">Use code</button>
        </form>}
      </section>
    </div>}
  </>
}
