import type { Request, Response } from 'express'
import { buildPageMeta, sendCollection, sendData } from '../../lib/envelope.js'
import { requireContext } from '../../middleware/requirePermission.js'
import {
  createProduct,
  createProductCategory,
  createUnit,
  createWarehouse,
  getProduct,
  listProductCategories,
  listProducts,
  listUnits,
  listWarehouses,
  updateProduct,
  updateProductCategory,
  updateUnit,
  updateWarehouse,
} from './catalogue.service.js'
import type {
  CreateProductCategoryInput,
  CreateProductInput,
  CreateUnitInput,
  CreateWarehouseInput,
  ListProductCategoriesQuery,
  ListProductsQuery,
  ListUnitsQuery,
  ListWarehousesQuery,
  UpdateProductCategoryInput,
  UpdateProductInput,
  UpdateUnitInput,
  UpdateWarehouseInput,
} from './catalogue.schemas.js'

export async function getUnits(req: Request, res: Response): Promise<void> {
  const query = req.validated?.query as ListUnitsQuery
  sendData(res, await listUnits(requireContext(req), query))
}

export async function postUnit(req: Request, res: Response): Promise<void> {
  const input = req.validated?.body as CreateUnitInput
  sendData(res, await createUnit(requireContext(req), input), 201)
}

export async function patchUnit(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  const input = req.validated?.body as UpdateUnitInput
  sendData(res, await updateUnit(requireContext(req), id, input))
}

export async function getProductCategories(req: Request, res: Response): Promise<void> {
  const query = req.validated?.query as ListProductCategoriesQuery
  sendData(res, await listProductCategories(requireContext(req), query))
}

export async function postProductCategory(req: Request, res: Response): Promise<void> {
  const input = req.validated?.body as CreateProductCategoryInput
  sendData(res, await createProductCategory(requireContext(req), input), 201)
}

export async function patchProductCategory(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  const input = req.validated?.body as UpdateProductCategoryInput
  sendData(res, await updateProductCategory(requireContext(req), id, input))
}

export async function getProducts(req: Request, res: Response): Promise<void> {
  const query = req.validated?.query as ListProductsQuery
  const { items, total } = await listProducts(requireContext(req), query)
  sendCollection(
    res,
    items,
    buildPageMeta({ page: query.page, pageSize: query.pageSize, total, sort: query.sort }),
  )
}

export async function getOneProduct(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  sendData(res, await getProduct(requireContext(req), id))
}

export async function postProduct(req: Request, res: Response): Promise<void> {
  const input = req.validated?.body as CreateProductInput
  sendData(res, await createProduct(requireContext(req), input), 201)
}

export async function patchProduct(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  const input = req.validated?.body as UpdateProductInput
  sendData(res, await updateProduct(requireContext(req), id, input))
}

export async function getWarehouses(req: Request, res: Response): Promise<void> {
  const query = req.validated?.query as ListWarehousesQuery
  sendData(res, await listWarehouses(requireContext(req), query))
}

export async function postWarehouse(req: Request, res: Response): Promise<void> {
  const input = req.validated?.body as CreateWarehouseInput
  sendData(res, await createWarehouse(requireContext(req), input), 201)
}

export async function patchWarehouse(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  const input = req.validated?.body as UpdateWarehouseInput
  sendData(res, await updateWarehouse(requireContext(req), id, input))
}
