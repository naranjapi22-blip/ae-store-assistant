export class WarehouseService {
  constructor(repository) { this.repository = repository; }

  async getWarehouses() {
    return this.repository.listWarehouses();
  }
}
